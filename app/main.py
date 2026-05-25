from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from aiogram.types import Update
from app.services.ai_client import AIClient
from app.core.config import settings
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
async def healthcheck():
    return {"status": "ok"}

@app.post("/webhook")
async def telegram_webhook(request: Request):
    secret_header = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
    if secret_header != settings.WEBHOOK_SECRET:
        logger.warning("Received webhook with invalid secret token")
        return {"status": "invalid token"}
    update = Update.model_validate(await request.json())
    telegram_bot: TelegramBot = request.app.state.telegram_bot
    await telegram_bot.dp.feed_update(telegram_bot.bot, update)
    return {"status": "ok"}

