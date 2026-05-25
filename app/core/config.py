from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings."""

    PROJECT_NAME: str = "Telegram Bot Satellite"
    TELEGRAM_BOT_TOKEN: str
    AI_ENGINE_URL: str
    AI_ENGINE_API_KEY: str 
    BASE_URL: str 
    WEBHOOK_SECRET: str
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")
        
settings = Settings()