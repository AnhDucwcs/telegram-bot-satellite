from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import settings
from app.core.logger import logger

class Database:
    client: AsyncIOMotorClient = None
    db = None

db_instance = Database()

async def connect_to_mongo():
    logger.info("Connecting to MongoDB...")
    db_instance.client = AsyncIOMotorClient(settings.MONGO_URI)
    db_instance.db = db_instance.client.telegram_satellite_db
    
    # Initialize indexes
    try:
        # Create indexes for recent_locations
        await db_instance.db.recent_locations.create_index(
            [("user_id", 1), ("last_used_at", -1)]
        )
        
        # Create indexes for recent_routes
        await db_instance.db.recent_routes.create_index(
            [("user_id", 1), ("last_used_at", -1)]
        )
        logger.info("MongoDB connected and indexes verified.")
    except Exception as e:
        logger.error(f"Error initializing MongoDB: {e}")

async def close_mongo_connection():
    logger.info("Closing MongoDB connection...")
    if db_instance.client:
        db_instance.client.close()

def get_db():
    return db_instance.db
