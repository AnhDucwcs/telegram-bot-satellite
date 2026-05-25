import aiogram
from aiogram import Bot, Dispatcher, types
from app.handlers.route_handler import router
from app.core.config import settings

class TelegramBot:
    def __init__(self):
        self.bot = Bot(token=settings.TELEGRAM_BOT_TOKEN)
        self.dp = Dispatcher()
        self.dp["ai_client"] = None
        self.dp["session_manager"] = None

    async def set_webhook(self, url: str, secret_token: str | None = None):
        await self.bot.set_webhook(url, secret_token=secret_token)

    async def delete_webhook(self):
        await self.bot.delete_webhook()
    
    async def set_up_handlers(self):
        self.dp.include_router(router)
        