from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from app.services.ai_client import AIClient
from app.core.config import settings
from app.services.session_manager import session_manager
from bot.telegram_bot import TelegramBot
from app.core.logger import logger, setup_logging
from app.core.db import connect_to_mongo, close_mongo_connection
from app.api.telegram import router as telegram_router
from app.api.internal import router as internal_router
from app.api.webapp import router as webapp_router

setup_logging()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Connect MongoDB
    await connect_to_mongo()
    
    # 2. Init AI Client
    ai_client = AIClient()
    app.state.ai_client = ai_client 
    
    # 3. Init Telegram Bot
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

    # Cleanup
    await ai_client.client.aclose()
    session_manager.clear_all()
    try:
        await telegram_bot.delete_webhook()
    except Exception as exc:
        logger.warning(f"Skip Telegram webhook cleanup: {exc}")
    await close_mongo_connection()

app = FastAPI(lifespan=lifespan)

# Mount static files for WebApp
import os
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
@app.head("/")
async def healthcheck():
    return {"status": "ok"}

# Include Routers
app.include_router(telegram_router)
app.include_router(internal_router)
app.include_router(webapp_router)
