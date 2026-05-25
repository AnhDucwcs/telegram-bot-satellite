import importlib
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient


def test_start_webhook_sends_welcome_message(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:abc")
    monkeypatch.delenv("BASE_URL", raising=False)
    monkeypatch.delenv("AI_ENGINE_URL", raising=False)
    monkeypatch.delenv("AI_ENGINE_API_KEY", raising=False)
    monkeypatch.delenv("AI_ENGINE_WEB_URL", raising=False)

    main = importlib.import_module("app.main")

    with TestClient(main.app) as client:
        main.app.state.bot.send_message = AsyncMock()

        response = client.post(
            "/webhook",
            json={
                "update_id": 1,
                "message": {
                    "message_id": 1,
                    "chat": {"id": 42, "type": "private"},
                    "text": "/start",
                },
            },
        )

        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
        main.app.state.bot.send_message.assert_awaited_once_with(
            chat_id=42,
            text=main.START_MESSAGE,
        )