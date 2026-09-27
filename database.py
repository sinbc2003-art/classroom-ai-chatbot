import sqlite3
import os
from datetime import datetime
from typing import Optional, List, Dict, Any

DB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DB_PATH = os.path.join(DB_DIR, "classroom_chat.db")

def get_connection():
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30.0)
    conn.row_factory = sqlite3.Row
    # Enable WAL mode for high concurrency with multiple students
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    
    # 1. Settings Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );
    """)
    
    # 2. Students Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    
    # 3. Sessions Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        title TEXT DEFAULT '대화 세션',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
    );
    """)
    
    # 4. Messages Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        model TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    """)
    
    # Insert default settings if not exists
    defaults = {
        "openai_api_key": "",
        "active_model": "gpt-4o-mini",
        "admin_pin": "1234",
        "system_prompt": "당신은 학생들을 위한 친절하고 유익한 AI 교육 보조교사입니다. 개념을 알기 쉽게 설명하고, 답을 일방적으로 알려주기보다는 학생이 스스로 생각할 수 있도록 단계별 힌트를 제공하세요. 수식은 LaTeX 문법($...$ 또는 $$...$$)을 사용하여 정확히 작성하세요.",
        "temperature": "0.7"
    }
    for k, v in defaults.items():
        cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?);", (k, v))
        
    conn.commit()
    conn.close()

def get_setting(key: str, default: str = "") -> str:
    conn = get_connection()
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else default

def set_setting(key: str, value: str):
    conn = get_connection()
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))
    conn.commit()
    conn.close()

def get_all_settings() -> Dict[str, str]:
    conn = get_connection()
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    conn.close()
    return {row["key"]: row["value"] for row in rows}

def get_or_create_student(name: str) -> Dict[str, Any]:
    name = name.strip()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM students WHERE name = ?", (name,))
    student = cursor.fetchone()
    
    if not student:
        cursor.execute("INSERT INTO students (name, last_active) VALUES (?, CURRENT_TIMESTAMP)", (name,))
        conn.commit()
        student_id = cursor.lastrowid
        # Create initial session
        cursor.execute("INSERT INTO sessions (student_id, title) VALUES (?, ?)", (student_id, "새 대화"))
        conn.commit()
        session_id = cursor.lastrowid
    else:
        student_id = student["id"]
        cursor.execute("UPDATE students SET last_active = CURRENT_TIMESTAMP WHERE id = ?", (student_id,))
        conn.commit()
        # Find latest session or create new
        last_session = cursor.execute("SELECT id FROM sessions WHERE student_id = ? ORDER BY id DESC LIMIT 1", (student_id,)).fetchone()
        if last_session:
            session_id = last_session["id"]
        else:
            cursor.execute("INSERT INTO sessions (student_id, title) VALUES (?, ?)", (student_id, "새 대화"))
            conn.commit()
            session_id = cursor.lastrowid
            
    conn.close()
    return {"id": student_id, "name": name, "session_id": session_id}

def create_new_session(student_id: int, title: str = "새 대화") -> int:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO sessions (student_id, title) VALUES (?, ?)", (student_id, title))
    conn.commit()
    session_id = cursor.lastrowid
    conn.close()
    return session_id

def add_message(session_id: int, role: str, content: str, model: str = ""):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO messages (session_id, role, content, model) VALUES (?, ?, ?, ?)",
        (session_id, role, content, model)
    )
    # Update student's last_active
    cursor.execute("""
        UPDATE students SET last_active = CURRENT_TIMESTAMP 
        WHERE id = (SELECT student_id FROM sessions WHERE id = ?)
    """, (session_id,))
    conn.commit()
    conn.close()

def get_session_messages(session_id: int) -> List[Dict[str, Any]]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, role, content, model, created_at FROM messages WHERE session_id = ? ORDER BY id ASC",
        (session_id,)
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]

def get_recent_messages_for_llm(session_id: int, limit: int = 15) -> List[Dict[str, str]]:
    """Gets the last N messages formatted for OpenAI API."""
    conn = get_connection()
    rows = conn.execute(
        "SELECT role, content FROM (SELECT id, role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC",
        (session_id, limit)
    ).fetchall()
    conn.close()
    return [{"role": row["role"], "content": row["content"]} for row in rows]

def get_all_students_with_stats() -> List[Dict[str, Any]]:
    conn = get_connection()
    query = """
    SELECT 
        s.id, 
        s.name, 
        s.created_at, 
        s.last_active,
        COUNT(DISTINCT sess.id) AS session_count,
        COUNT(m.id) AS message_count
    FROM students s
    LEFT JOIN sessions sess ON s.id = sess.student_id
    LEFT JOIN messages m ON sess.id = m.session_id
    GROUP BY s.id
    ORDER BY s.last_active DESC
    """
    rows = conn.execute(query).fetchall()
    conn.close()
    return [dict(row) for row in rows]

def get_student_details(student_id: int) -> Dict[str, Any]:
    conn = get_connection()
    student = conn.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
    if not student:
        conn.close()
        return {}
    
    sessions = conn.execute("SELECT * FROM sessions WHERE student_id = ? ORDER BY id DESC", (student_id,)).fetchall()
    sessions_data = []
    for sess in sessions:
        msgs = conn.execute("SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC", (sess["id"],)).fetchall()
        sessions_data.append({
            "id": sess["id"],
            "title": sess["title"],
            "created_at": sess["created_at"],
            "messages": [dict(m) for m in msgs]
        })
    conn.close()
    return {
        "student": dict(student),
        "sessions": sessions_data
    }

def delete_student(student_id: int):
    conn = get_connection()
    conn.execute("DELETE FROM students WHERE id = ?", (student_id,))
    conn.commit()
    conn.close()

def delete_all_history():
    conn = get_connection()
    conn.execute("DELETE FROM messages;")
    conn.execute("DELETE FROM sessions;")
    conn.execute("DELETE FROM students;")
    conn.commit()
    conn.close()

def get_export_rows(student_id: Optional[int] = None) -> List[Dict[str, Any]]:
    conn = get_connection()
    query = """
    SELECT 
        s.name AS student_name,
        sess.id AS session_id,
        sess.title AS session_title,
        m.id AS message_id,
        m.role,
        m.content,
        m.model,
        m.created_at
    FROM messages m
    JOIN sessions sess ON m.session_id = sess.id
    JOIN students s ON sess.student_id = s.id
    """
    params = ()
    if student_id:
        query += " WHERE s.id = ? "
        params = (student_id,)
    query += " ORDER BY s.name ASC, sess.id ASC, m.id ASC"
    
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(row) for row in rows]
