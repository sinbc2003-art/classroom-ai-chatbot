import sys
import unittest
from fastapi.testclient import TestClient
from main import app
import database

class TestClassroomChatbot(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        database.init_db()
        cls.client = TestClient(app)

    def test_01_index_and_admin_pages(self):
        # Student page
        r = self.client.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("AI 학습 튜터", r.text)

        # Admin page
        r = self.client.get("/admin")
        self.assertEqual(r.status_code, 200)
        self.assertIn("관리자 센터", r.text)

    def test_02_system_info(self):
        r = self.client.get("/api/info")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("server_ip", data)
        self.assertIn("active_model", data)
        self.assertEqual(data["port"], 8000)

    def test_03_student_login_and_session(self):
        # Login student
        r = self.client.post("/api/student/login", json={"name": "20101 홍길동"})
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["name"], "20101 홍길동")
        self.assertIn("id", data)
        self.assertIn("session_id", data)

        student_id = data["id"]

        # New chat session
        r = self.client.post("/api/student/new-chat", json={"student_id": student_id})
        self.assertEqual(r.status_code, 200)
        data2 = r.json()
        self.assertIn("session_id", data2)

    def test_04_admin_auth_and_settings(self):
        # Wrong pin
        r = self.client.post("/api/admin/verify", json={"pin": "wrong"})
        self.assertEqual(r.status_code, 401)

        # Correct default pin
        r = self.client.post("/api/admin/verify", json={"pin": "1234"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json().get("success"))

        # Get settings
        r = self.client.get("/api/admin/settings?pin=1234")
        self.assertEqual(r.status_code, 200)
        settings = r.json()
        self.assertIn("active_model", settings)

        # Update settings
        r = self.client.post("/api/admin/settings", json={
            "pin": "1234",
            "active_model": "gpt-4o",
            "temperature": "0.5"
        })
        self.assertEqual(r.status_code, 200)

        # Verify update took effect
        r = self.client.get("/api/admin/settings?pin=1234")
        self.assertEqual(r.json()["active_model"], "gpt-4o")
        self.assertEqual(r.json()["temperature"], "0.5")

    def test_05_admin_students_and_export(self):
        # Check student list
        r = self.client.get("/api/admin/students?pin=1234")
        self.assertEqual(r.status_code, 200)
        students = r.json().get("students", [])
        self.assertGreaterEqual(len(students), 1)

        # Export CSV
        r = self.client.get("/api/admin/export/csv?pin=1234")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["content-type"], "text/csv; charset=utf-8")
        # Check UTF-8 BOM
        self.assertTrue(r.content.startswith(b"\xef\xbb\xbf"))

    def test_06_chat_stream_missing_api_key(self):
        # Empty API key should yield helpful guidance message without crashing
        database.set_setting("openai_api_key", "")
        # Create student and message
        login_res = self.client.post("/api/student/login", json={"name": "20102 김철수"}).json()
        r = self.client.post("/api/chat/stream", json={
            "student_id": login_res["id"],
            "session_id": login_res["session_id"],
            "message": "안녕? 이차방정식 공식 알려줘."
        })
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/event-stream", r.headers["content-type"])
        content = r.text
        self.assertIn("관리자가 아직 OpenAI API 키를 등록하지 않았습니다", content)

if __name__ == "__main__":
    unittest.main()
