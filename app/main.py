from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from aiogram.types import Update
from pydantic import ValidationError
from app.services.ai_client import AIClient
from app.core.config import settings
from app.models.request_models import TelegramUpdate
from app.services.session_manager import session_manager
from bot.telegram_bot import TelegramBot
from app.core.logger import logger, setup_logging

setup_logging()

@asynccontextmanager
async def lifespan(app: FastAPI):
    ai_client = AIClient()
    app.state.ai_client = ai_client 
    telegram_bot = TelegramBot()
    telegram_bot.dp["ai_client"] = ai_client
    telegram_bot.dp["session_manager"] = session_manager
    await telegram_bot.set_up_handlers()

    webhook_url = f"{settings.BASE_URL}/webhook"
    try:
        await telegram_bot.set_webhook(webhook_url, secret_token=settings.WEBHOOK_SECRET)
    except Exception as exc:
        logger.warning(f"Skip Telegram webhook setup: {exc}")
    app.state.telegram_bot = telegram_bot

    yield

    await ai_client.client.aclose()
    session_manager.clear_all()
    try:
        await telegram_bot.delete_webhook()
    except Exception as exc:
        logger.warning(f"Skip Telegram webhook cleanup: {exc}")


app = FastAPI(lifespan=lifespan)


@app.get("/")
@app.head("/")
async def healthcheck():
    return {"status": "ok"}

@app.post("/webhook")
async def telegram_webhook(request: Request):
    secret_header = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
    if secret_header != settings.WEBHOOK_SECRET:
        logger.warning("Received webhook with invalid secret token")
        return {"status": "invalid token"}
    try:
        data = await request.json()
        logger.info(f"Received webhook payload: {data}")
        # validate sớm để tránh feed những payload không hợp lệ vào aiogram dispatcher
        TelegramUpdate.model_validate(data)
        # dựng lên đối tượng Update của aiogram để feed vào dispatcher
        update = Update.model_validate(data)
        telegram_bot: TelegramBot = request.app.state.telegram_bot
        # provide app state to dispatcher handlers via dispatcher storage
        telegram_bot.dp["app_state"] = request.app.state
        try:
            await telegram_bot.dp.feed_update(telegram_bot.bot, update)
        except Exception as exc:
            logger.error(f"Error while feeding update to dispatcher: {exc}")
            raise
    except ValidationError as e:
        logger.error(f"Invalid Telegram update payload: {e}")
        return {"status": "invalid payload"}
    finally:
        return {"status": "ok"}  # Telegram yêu cầu response trong vòng 10s, nên dù có lỗi gì cũng phải trả về để tránh bị retry liên tục

@app.post("/internal/result")
async def receive_result(request: Request):
    secret_header = request.headers.get("x_internal_api_key")
    if secret_header != settings.INTERNAL_API_KEY:
        logger.warning("Received internal result with invalid API key")
        return {"status": "invalid API key"}

    data = await request.json()
    conversation_id = data.get("conversationId") or data.get("conversation_id")
    if not conversation_id:
        logger.warning("Received internal result without conversation id")
        return {"status": "missing conversation id"}

    chat_id = session_manager.pop_chat_id_by_conversation(conversation_id)
    if not chat_id:
        logger.warning(f"No chat mapping found for conversation: {conversation_id}")
        return {"status": "unknown conversation"}

    status = data.get("status")
    telegram_bot: TelegramBot = request.app.state.telegram_bot

    if status == "success":
        distance_km = data.get("distance_km")
        estimated_time_min = data.get("estimated_time_min")
        navigation_url = data.get("navigation_url")
        route_id = data.get("route_id")

        text = "Đã tìm thấy lộ trình phù hợp."
        if distance_km is not None and estimated_time_min is not None:
            text += f"\nQuãng đường: {distance_km} km\nThời gian dự kiến: {estimated_time_min} phút"
        if route_id:
            text += f"\nMã lộ trình: {route_id}"

        await telegram_bot.bot.send_message(chat_id=chat_id, text=text)

        if navigation_url:
            await telegram_bot.bot.send_message(chat_id=chat_id, text=f"Google Maps: {navigation_url}")
    else:
        error_message = data.get("message") or "Không tìm thấy lộ trình phù hợp."
        await telegram_bot.bot.send_message(chat_id=chat_id, text=error_message)

    return {"status": "ok"}
