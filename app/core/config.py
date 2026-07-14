from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings."""

    PROJECT_NAME: str = "Telegram Bot Satellite"
    TELEGRAM_BOT_TOKEN: str
    AI_ENGINE_URL: str
    BASE_URL: str 
    WEBHOOK_SECRET: str
    INTERNAL_API_KEY: str
    MONGO_URI: str
    INTERNAL_RESULT_CALLBACK_URL: str | None = None
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")
        
settings = Settings()