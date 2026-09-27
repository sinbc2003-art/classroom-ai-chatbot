import os
import json
import csv
import io
import socket
import logging
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, Request, Response, status
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import AsyncOpenAI
import openai

import database

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("classroom_chat")

import webbrowser
import threading

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB on startup
    database.init_db()
    ip = get_local_ip()
    port = 8000
    print("\n" + "="*60)
    print(f" Classroom Chatbot Platform Ready!")
    print(f" 학생 접속 주소 (Local):   http://localhost:{port}")
    print(f" 학생 접속 주소 (Wi-Fi):   http://{ip}:{port}")
    print(f" 관리자 페이지 (Admin):    http://{ip}:{port}/admin")
    print("="*60 + "\n")

    def _open_browser():
        import time
        time.sleep(1.0)
        try:
            webbrowser.open(f"http://localhost:{port}/admin")
        except Exception:
            pass

    threading.Thread(target=_open_browser, daemon=True).start()
    yield

app = FastAPI(title="Classroom Chatbot Platform", lifespan=lifespan)

# Enable CORS for local network access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_local_ip() -> str:
    """Detects the primary LAN IP of this machine."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # Doesn't actually send data, just connects to determine route
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

# --- Models ---
class StudentLoginRequest(BaseModel):
    name: str

class NewChatRequest(BaseModel):
    student_id: int

class ChatStreamRequest(BaseModel):
    student_id: int
    session_id: int
    message: str

class AdminPinVerifyRequest(BaseModel):
    pin: str

class AdminSettingsUpdateRequest(BaseModel):
    pin: str
    openai_api_key: Optional[str] = None
    active_model: Optional[str] = None
    new_admin_pin: Optional[str] = None
    system_prompt: Optional[str] = None
    temperature: Optional[str] = None

# --- Helper for Admin Auth ---
def verify_admin_pin(pin: str) -> bool:
    saved_pin = database.get_setting("admin_pin", "1234")
    return pin == saved_pin

# --- Static File Serving & Pages ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
os.makedirs(STATIC_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index_path = os.path.join(BASE_DIR, "index.html")
    if not os.path.exists(index_path):
        index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>Classroom Chatbot UI is loading...</h1>"

@app.get("/admin", response_class=HTMLResponse)
async def serve_admin():
    admin_path = os.path.join(STATIC_DIR, "admin.html")
    if os.path.exists(admin_path):
        with open(admin_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>Admin UI is loading...</h1>"

# --- Public & Student APIs ---

@app.get("/api/info")
async def get_system_info():
    ip = get_local_ip()
    port = 8000
    active_model = database.get_setting("active_model", "gpt-4o-mini")
    has_api_key = bool(database.get_setting("openai_api_key", "").strip())
    return {
        "server_ip": ip,
        "port": port,
        "active_model": active_model,
        "has_api_key": has_api_key
    }

@app.post("/api/student/login")
async def student_login(req: StudentLoginRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="이름이나 학번을 입력해 주세요.")
    student_data = database.get_or_create_student(name)
    return student_data

@app.post("/api/student/new-chat")
async def student_new_chat(req: NewChatRequest):
    new_session_id = database.create_new_session(req.student_id, "새 대화")
    return {"session_id": new_session_id}

@app.get("/api/student/messages/{session_id}")
async def get_messages(session_id: int):
    msgs = database.get_session_messages(session_id)
    return {"messages": msgs}

@app.post("/api/chat/stream")
async def chat_stream(req: ChatStreamRequest):
    message_content = req.message.strip()
    if not message_content:
        raise HTTPException(status_code=400, detail="메시지를 입력해 주세요.")
        
    api_key = database.get_setting("openai_api_key", "").strip()
    if not api_key:
        async def err_gen():
            msg = "관리자가 아직 OpenAI API 키를 등록하지 않았습니다. 선생님께 관리자 페이지(/admin) 설정을 요청해 주세요."
            yield f"data: {json.dumps({'error': msg}, ensure_ascii=False)}\n\n"
        return StreamingResponse(err_gen(), media_type="text/event-stream")

    active_model = database.get_setting("active_model", "gpt-4o-mini").strip()
    system_prompt = database.get_setting("system_prompt", "").strip()
    temperature_str = database.get_setting("temperature", "0.7")
    try:
        temperature = float(temperature_str)
    except ValueError:
        temperature = 0.7

    # Save student message
    database.add_message(req.session_id, "user", message_content, model=active_model)

    # Prepare chat history for OpenAI
    recent_history = database.get_recent_messages_for_llm(req.session_id, limit=12)

    is_reasoning = active_model.startswith("o1") or active_model.startswith("o3")
    messages_payload = []
    
    if system_prompt:
        role_for_system = "developer" if is_reasoning else "system"
        messages_payload.append({"role": role_for_system, "content": system_prompt})
        
    messages_payload.extend(recent_history)

    async def stream_generator():
        collected_chunks = []
        try:
            client = AsyncOpenAI(api_key=api_key)
            kwargs = {
                "model": active_model,
                "messages": messages_payload,
                "stream": True,
            }
            if not is_reasoning:
                kwargs["temperature"] = temperature

            response = await client.chat.completions.create(**kwargs)

            async for chunk in response:
                if chunk.choices and len(chunk.choices) > 0:
                    delta = chunk.choices[0].delta
                    content = delta.content or ""
                    if content:
                        collected_chunks.append(content)
                        yield f"data: {json.dumps({'delta': content}, ensure_ascii=False)}\n\n"

            # Save full response to database
            full_assistant_message = "".join(collected_chunks)
            if full_assistant_message:
                database.add_message(req.session_id, "assistant", full_assistant_message, model=active_model)
            
            yield f"data: {json.dumps({'done': True, 'model': active_model}, ensure_ascii=False)}\n\n"

        except openai.AuthenticationError:
            err_msg = "OpenAI API 인증 오류: 유효하지 않은 API 키입니다. 관리자 페이지에서 API 키를 확인해 주세요."
            yield f"data: {json.dumps({'error': err_msg}, ensure_ascii=False)}\n\n"
        except openai.RateLimitError:
            err_msg = "OpenAI 사용량 초과(Rate Limit 또는 잔액 부족): 잠시 후 다시 시도하거나 API 키 잔액을 확인해 주세요."
            yield f"data: {json.dumps({'error': err_msg}, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"Chat streaming error: {str(e)}")
            err_msg = f"오류 발생 ({type(e).__name__}): {str(e)}"
            yield f"data: {json.dumps({'error': err_msg}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        stream_generator(), 
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

# --- Admin APIs ---

@app.post("/api/admin/verify")
async def admin_verify_pin(req: AdminPinVerifyRequest):
    if verify_admin_pin(req.pin):
        return {"success": True}
    raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다.")

@app.get("/api/admin/settings")
async def admin_get_settings(pin: str):
    if not verify_admin_pin(pin):
        raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다.")
    
    settings = database.get_all_settings()
    raw_key = settings.get("openai_api_key", "")
    masked_key = ""
    if raw_key:
        if len(raw_key) > 8:
            masked_key = raw_key[:3] + "..." + raw_key[-4:]
        else:
            masked_key = "***"
            
    return {
        "has_api_key": bool(raw_key),
        "masked_api_key": masked_key,
        "active_model": settings.get("active_model", "gpt-4o-mini"),
        "system_prompt": settings.get("system_prompt", ""),
        "temperature": settings.get("temperature", "0.7"),
        "server_ip": get_local_ip(),
        "port": 8000
    }

@app.post("/api/admin/settings")
async def admin_update_settings(req: AdminSettingsUpdateRequest):
    if not verify_admin_pin(req.pin):
        raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다.")
        
    if req.openai_api_key is not None and req.openai_api_key.strip():
        database.set_setting("openai_api_key", req.openai_api_key.strip())
        
    if req.active_model is not None and req.active_model.strip():
        database.set_setting("active_model", req.active_model.strip())
        
    if req.system_prompt is not None:
        database.set_setting("system_prompt", req.system_prompt)
        
    if req.temperature is not None and req.temperature.strip():
        database.set_setting("temperature", req.temperature.strip())
        
    if req.new_admin_pin is not None and req.new_admin_pin.strip():
        database.set_setting("admin_pin", req.new_admin_pin.strip())
        
    return {"success": True, "message": "설정이 성공적으로 저장되었습니다."}

@app.get("/api/admin/models")
async def admin_get_models(pin: str, test_key: Optional[str] = None):
    if not verify_admin_pin(pin):
        raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다.")
        
    api_key = test_key.strip() if test_key and test_key.strip() else database.get_setting("openai_api_key", "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="OpenAI API 키가 설정되지 않았습니다. API 키를 먼저 입력해 주세요.")
        
    try:
        client = AsyncOpenAI(api_key=api_key)
        model_list_resp = await client.models.list()
        
        # Sort and categorize models
        all_models = [m.id for m in model_list_resp.data]
        
        # Filter for models suitable for chat/text
        chat_keywords = ["gpt-4", "gpt-3.5", "o1", "o3", "chatgpt"]
        popular_chat_models = []
        other_models = []
        
        for mid in sorted(all_models):
            if any(k in mid.lower() for k in chat_keywords):
                popular_chat_models.append(mid)
            else:
                other_models.append(mid)
                
        # Prioritize widely used models at top
        priority_order = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "o3-mini", "o1", "o1-mini", "gpt-3.5-turbo"]
        sorted_popular = []
        for p in priority_order:
            if p in popular_chat_models:
                sorted_popular.append(p)
        for m in popular_chat_models:
            if m not in sorted_popular:
                sorted_popular.append(m)

        return {
            "current_model": database.get_setting("active_model", "gpt-4o-mini"),
            "chat_models": sorted_popular,
            "all_models": all_models
        }
    except openai.AuthenticationError:
        raise HTTPException(status_code=400, detail="API 키가 올바르지 않습니다. 키를 다시 확인해 주세요.")
    except Exception as e:
        logger.error(f"Error fetching models: {e}")
        raise HTTPException(status_code=500, detail=f"모델 목록 호출 실패: {str(e)}")

@app.get("/api/admin/students")
async def admin_get_students(pin: str):
    if not verify_admin_pin(pin):
        raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다.")
    students = database.get_all_students_with_stats()
    return {"students": students}

@app.get("/api/admin/students/{student_id}")
async def admin_get_student_detail(student_id: int, pin: str):
    if not verify_admin_pin(pin):
        raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다.")
    detail = database.get_student_details(student_id)
    if not detail:
        raise HTTPException(status_code=404, detail="학생을 찾을 수 없습니다.")
    return detail

@app.delete("/api/admin/students/{student_id}")
async def admin_delete_student(student_id: int, pin: str):
    if not verify_admin_pin(pin):
        raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다.")
    database.delete_student(student_id)
    return {"success": True}

@app.post("/api/admin/clear-all-history")
async def admin_clear_all(req: AdminPinVerifyRequest):
    if not verify_admin_pin(req.pin):
        raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다.")
    database.delete_all_history()
    return {"success": True, "message": "모든 학생 및 대화 내역이 초기화되었습니다."}

@app.get("/api/admin/export/csv")
async def admin_export_csv(pin: str, student_id: Optional[int] = None):
    if not verify_admin_pin(pin):
        raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다.")
        
    rows = database.get_export_rows(student_id)
    
    output = io.StringIO()
    # Write UTF-8 BOM so Excel on Windows opens Korean correctly
    output.write("\ufeff")
    
    writer = csv.writer(output)
    writer.writerow(["학생 이름", "세션 ID", "세션 제목", "메시지 ID", "발화자(Role)", "메시지 내용", "사용 모델", "작성 시간"])
    
    for r in rows:
        role_kr = "학생" if r["role"] == "user" else ("AI 보조교사" if r["role"] == "assistant" else r["role"])
        writer.writerow([
            r["student_name"],
            r["session_id"],
            r["session_title"],
            r["message_id"],
            role_kr,
            r["content"],
            r["model"] or "",
            r["created_at"]
        ])
        
    csv_bytes = output.getvalue().encode("utf-8-sig")
    filename = f"classroom_chat_export_{student_id or 'all'}.csv"
    
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

