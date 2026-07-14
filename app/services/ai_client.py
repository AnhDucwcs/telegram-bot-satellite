import httpx

from app.core.config import settings

class AIClient:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=120.0)
        self.ai_engine_url = settings.AI_ENGINE_URL

    def _build_callback_url(self) -> str:
        if settings.INTERNAL_RESULT_CALLBACK_URL:
            return settings.INTERNAL_RESULT_CALLBACK_URL
        return f"{settings.BASE_URL}/internal/result"

    async def get_route(self, start_lat, start_lng, end_lat, end_lng, user_id: str, conversation_id: str):
        headers = {
            "x-internal-api-key": settings.INTERNAL_API_KEY,
            "Content-Type": "application/json"
        }
        payload = {
            "userId": user_id,
            "conversationId": conversation_id,
            "platform": "telegram",
            "callbackUrl": self._build_callback_url(),
            "origin": {
                "latitude": start_lat,
                "longitude": start_lng
            },
            "destination": {
                "latitude": end_lat,
                "longitude": end_lng
            }
        }
        try:
            routing_url = f"{self.ai_engine_url}/api/v1/routing/"
            response = await self.client.post(routing_url, json=payload, headers=headers)
            if response.status_code in (200, 202):
                data = response.json()
                return data
            else:
                raise Exception(f"AI Engine returned status code {response.status_code}: {response.text}")
        except Exception as e:
            raise Exception(f"Error occurred while fetching route: {str(e)}")