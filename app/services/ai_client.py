import asyncio
import httpx

from app.core.config import settings

class AIClient:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=120.0)
        self.ai_engine_url = settings.AI_ENGINE_URL
        self.ai_engine_api_key = settings.AI_ENGINE_API_KEY

    async def get_route(self, start_lat, start_lng, end_lat, end_lng):
        headers = {
            "Authorization": f"Bearer {self.ai_engine_api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "userId": "user123",
            "platform": "telegram",
            "origin": {
                "lat": start_lat,
                "lng": start_lng
            },
            "destination": {
                "lat": end_lat,
                "lng": end_lng
            }
        }
        try:
            response = await self.client.post(self.ai_engine_url, json=payload, headers=headers)
            if response.status_code == 200:
                data = response.json()
                return data
            else:
                raise Exception(f"AI Engine returned status code {response.status_code}: {response.text}")
        except Exception as e:
            raise Exception(f"Error occurred while fetching route: {str(e)}")