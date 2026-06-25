from fastapi import APIRouter, Request
from aiogram.types import Update
from pydantic import ValidationError
from app.core.config import settings
from app.core.logger import logger
from app.models.request_models import TelegramUpdate
from bot.telegram_bot import TelegramBot

router = APIRouter(tags=["telegram"])

@router.post("/webhook")
async def telegram_webhook(request: Request):
    secret_header = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
    if secret_header != settings.WEBHOOK_SECRET:
        logger.warning("Received webhook with invalid secret token")
        return {"status": "invalid token"}
    try:
        data = await request.json()
        TelegramUpdate.model_validate(data)
        update = Update.model_validate(data)
        telegram_bot: TelegramBot = request.app.state.telegram_bot
        telegram_bot.dp["app_state"] = request.app.state
        try:
            await telegram_bot.dp.feed_update(telegram_bot.bot, update)
        except Exception as exc:
            logger.error(f"Error while feeding update to dispatcher: {exc}")
    except ValidationError as e:
        logger.error(f"Invalid Telegram update payload: {e}")
        return {"status": "invalid payload"}
    except Exception as exc:
        logger.error(f"Unhandled error in Telegram webhook: {exc}")

    return {"status": "ok"}
