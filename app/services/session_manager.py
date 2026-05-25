import asyncio
from cachetools import TTLCache

class SessionManager:
    def __init__(self, maxsize: int = 10000, ttl: int = 300):
        self._sessions = TTLCache(maxsize=maxsize, ttl=ttl)
        self._locks = {}

    def get_or_create_lock(self, session_id: str) -> asyncio.Lock:
        """Lấy khóa hiện tại hoặc tạo khóa mới một cách an toàn."""
        if session_id not in self._locks:
            self._locks[session_id] = asyncio.Lock()
        return self._locks[session_id]

    def get_session(self, session_id: str):
        return self._sessions.get(session_id)

    def set_session(self, session_id: str, session_obj):
        self._sessions[session_id] = session_obj

    def has_session(self, session_id: str) -> bool:
        return session_id in self._sessions

    def clear_session(self, session_id: str):
        """Chủ động xóa phiên làm việc khi kịch bản kết thúc."""
        if session_id in self._sessions:
            del self._sessions[session_id]

    def ensure_cleanup(self, session_id: str):
        """
        Nếu phiên không còn hoạt động hoặc đã bị xóa
        Dọn dẹp triệt để cả Session và Lock để chống Rò rỉ RAM (Memory Leak)
        """
        if session_id not in self._sessions:
            if session_id in self._locks:
                del self._locks[session_id]

    def clear_all(self):
        """Dùng cho hàm shutdown hệ thống."""
        self._sessions.clear()
        self._locks.clear()

# Khởi tạo một instance duy nhất (Singleton Pattern) để dùng chung toàn hệ thống
session_manager = SessionManager()