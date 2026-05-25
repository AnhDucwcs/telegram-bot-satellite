from pydantic import BaseModel

class UserSession(BaseModel):
    session_id: str # Định danh duy nhất cho mỗi phiên làm việc của người dùng
    state: str  # "awaiting_start" hoặc "awaiting_end"
    start_lat: float | None = None
    start_lng: float | None = None