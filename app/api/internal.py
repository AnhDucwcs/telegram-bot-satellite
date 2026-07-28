from fastapi import APIRouter, Request
from app.core.config import settings
from app.core.logger import logger
from bot.telegram_bot import TelegramBot
from app.services.session_manager import session_manager
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.types.web_app_info import WebAppInfo

router = APIRouter(prefix="/internal", tags=["internal"])

@router.post("/result")
async def receive_result(request: Request):
    secret_header = request.headers.get("x-internal-api-key")
    if secret_header != settings.INTERNAL_API_KEY:
        logger.warning("Received internal result with invalid API key")
        return {"status": "invalid API key"}

    data = await request.json()
    user_id = data.get("userId") or data.get("user_id")
    job_id = data.get("job_id")  # Assuming the AI engine returns a job_id or we use user_id to match.

    # 1. Store result for WebApp Polling
    # Note: In production, save to Redis with a TTL.
    if not hasattr(request.app.state, 'job_results'):
        request.app.state.job_results = {}
        
    # We create a pseudo job_id if not present for the webapp polling
    # For now, let's just use the user_id as a key if job_id is missing, but this needs refinement.
    # Actually, we can just save it for any pending webapp requests.
    status = data.get("status")
    
    if status == "success":
        # Cache for WebApp
        if user_id:
            # pseudo job_id matches webapp.py logic
            # This is a bit hacky, but we will store it under user_id for now
            # You should pass a unique route_id from WebApp -> AI Engine -> Webhook -> WebApp
            route_id = data.get("route_id")
            request.app.state.job_results[f"job_{user_id}"] = data
            
        # 2. Optionally, send Telegram message to user
        # (This is the old bot logic, still keeping it for compatibility)
        chat_id = int(user_id) if user_id else None
        if chat_id:
            telegram_bot: TelegramBot = request.app.state.telegram_bot
            distance_km = data.get("distance_km")
            estimated_time_min = data.get("estimated_time_min")

            pending = getattr(request.app.state, 'pending_routes', {}).get(f"job_{user_id}", {})
            
            # Skip sending message if this is just a background re-route
            if not pending.get("is_reroute", False):
                origin_name = pending.get("origin_name", "Vị trí bắt đầu")
                destination_name = pending.get("destination_name", "Vị trí kết thúc")

                text = f"Đã tìm thấy lộ trình: {origin_name} ➔ {destination_name}"
                if distance_km is not None and estimated_time_min is not None:
                    dist = round(distance_km, 2)
                    time = round(estimated_time_min, 2)
                    text += f"\nQuãng đường: {dist} km\nThời gian dự kiến: {time} phút"

                try:
                    await telegram_bot.bot.send_message(chat_id=chat_id, text=text)
                except Exception as e:
                    logger.error(f"Failed to send result to telegram: {e}")
            
    else:
        # Failure case
        if user_id:
            request.app.state.job_results[f"job_{user_id}"] = {"status": "error", "message": data.get("message")}

    return {"status": "ok"}
