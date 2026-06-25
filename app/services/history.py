from datetime import datetime, timezone
from app.core.logger import logger
from app.core.db import get_db

# Max items per user
MAX_RECENT_LOCATIONS = 10
MAX_RECENT_ROUTES = 3

class HistoryService:
    @staticmethod
    async def add_recent_location(user_id: int, location: dict):
        """
        Add or update a recent location.
        location format: {"name": str, "lat": float, "lng": float, "address": str (optional)}
        """
        db = get_db()
        now = datetime.now(timezone.utc)
        
        # 1. Upsert the location (if it already exists, just update last_used_at)
        await db.recent_locations.update_one(
            {
                "user_id": user_id, 
                "name": location["name"],
                "lat": location["lat"],
                "lng": location["lng"]
            },
            {
                "$set": {
                    "address": location.get("address", ""),
                    "last_used_at": now
                }
            },
            upsert=True
        )
        
        # 2. Enforce limits: Find the count, if > MAX, delete the oldest
        count = await db.recent_locations.count_documents({"user_id": user_id})
        if count > MAX_RECENT_LOCATIONS:
            # Find the oldest document
            oldest = await db.recent_locations.find_one(
                {"user_id": user_id}, 
                sort=[("last_used_at", 1)]
            )
            if oldest:
                await db.recent_locations.delete_one({"_id": oldest["_id"]})

    @staticmethod
    async def add_recent_route(user_id: int, origin: dict, destination: dict):
        """
        Add or update a recent route.
        origin, destination format: {"name": str, "lat": float, "lng": float}
        """
        db = get_db()
        now = datetime.now(timezone.utc)
        
        # 1. Upsert the route
        await db.recent_routes.update_one(
            {
                "user_id": user_id,
                "origin.name": origin["name"],
                "destination.name": destination["name"]
            },
            {
                "$set": {
                    "origin": origin,
                    "destination": destination,
                    "last_used_at": now
                }
            },
            upsert=True
        )
        
        # 2. Enforce limits
        count = await db.recent_routes.count_documents({"user_id": user_id})
        if count > MAX_RECENT_ROUTES:
            oldest = await db.recent_routes.find_one(
                {"user_id": user_id}, 
                sort=[("last_used_at", 1)]
            )
            if oldest:
                await db.recent_routes.delete_one({"_id": oldest["_id"]})

    @staticmethod
    async def get_recent_locations(user_id: int) -> list:
        db = get_db()
        cursor = db.recent_locations.find(
            {"user_id": user_id},
            {"_id": 0} # Exclude MongoDB ObjectId
        ).sort("last_used_at", -1).limit(MAX_RECENT_LOCATIONS)
        return await cursor.to_list(length=MAX_RECENT_LOCATIONS)

    @staticmethod
    async def get_recent_routes(user_id: int) -> list:
        db = get_db()
        cursor = db.recent_routes.find(
            {"user_id": user_id},
            {"_id": 0}
        ).sort("last_used_at", -1).limit(MAX_RECENT_ROUTES)
        return await cursor.to_list(length=MAX_RECENT_ROUTES)
