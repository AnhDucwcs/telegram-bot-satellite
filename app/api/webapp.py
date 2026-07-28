from fastapi import APIRouter, Request, HTTPException, Header, Depends
import hmac
import hashlib
from urllib.parse import parse_qsl
from typing import Optional
from app.core.config import settings
from app.services.history import HistoryService

router = APIRouter(prefix="/api/v1/webapp", tags=["webapp"])

def verify_telegram_web_app_data(init_data: str) -> dict:
    """
    Verify telegram initData to ensure request comes from a valid Telegram user.
    """
    try:
        parsed_data = dict(parse_qsl(init_data))
        hash_val = parsed_data.pop('hash', None)
        if not hash_val:
            return None
            
        data_check_string = '\n'.join(
            f"{k}={v}" for k, v in sorted(parsed_data.items())
        )
        
        secret_key = hmac.new(
            b"WebAppData",
            settings.TELEGRAM_BOT_TOKEN.encode(),
            hashlib.sha256
        ).digest()
        
        calculated_hash = hmac.new(
            secret_key,
            data_check_string.encode(),
            hashlib.sha256
        ).hexdigest()
        
        if calculated_hash == hash_val:
            # Successfully verified, you can parse 'user' from parsed_data
            import json
            user_data = json.loads(parsed_data.get('user', '{}'))
            return user_data
    except Exception:
        pass
    return None

async def get_current_user(x_telegram_init_data: Optional[str] = Header(None)):
    if not x_telegram_init_data:
        # Tạm thời để dễ test dev (thực tế nên raise 401)
        return {"id": 123456789, "first_name": "Dev User"}
        
    user_data = verify_telegram_web_app_data(x_telegram_init_data)
    if not user_data:
        raise HTTPException(status_code=401, detail="Invalid Telegram InitData")
    return user_data

@router.get("/history/locations")
async def get_recent_locations(user: dict = Depends(get_current_user)):
    user_id = user["id"]
    locations = await HistoryService.get_recent_locations(user_id)
    return {"status": "ok", "locations": locations}

@router.get("/history/routes")
async def get_recent_routes(user: dict = Depends(get_current_user)):
    user_id = user["id"]
    routes = await HistoryService.get_recent_routes(user_id)
    return {"status": "ok", "routes": routes}

@router.post("/history/location")
async def save_location(location: dict, user: dict = Depends(get_current_user)):
    """Save a single location when user searches for it"""
    user_id = user["id"]
    await HistoryService.add_recent_location(user_id, location)
    return {"status": "ok"}

@router.post("/route")
async def create_route_job(payload: dict, request: Request, user: dict = Depends(get_current_user)):
    """
    Proxy API to create a routing job and save the route history.
    """
    user_id = user["id"]
    
    # 1. Save to history
    origin = payload.get("origin")
    destination = payload.get("destination")
    is_reroute = payload.get("is_reroute", False)
    start_navigation = payload.get("start_navigation", False)
    
    if origin and destination and not is_reroute and start_navigation:
        await HistoryService.add_recent_route(user_id, origin, destination)
        
    if not hasattr(request.app.state, 'pending_routes'):
        request.app.state.pending_routes = {}
        
    request.app.state.pending_routes[f"job_{user_id}"] = {
        "origin_name": origin.get("name", "Vị trí bắt đầu"),
        "destination_name": destination.get("name", "Vị trí kết thúc"),
        "is_reroute": is_reroute
    }
        
    # 2. Forward to AI engine
    ai_client = request.app.state.ai_client
    # Gửi qua AI Engine kèm userId để nó gửi callback về
    response = await ai_client.client.post(
        f"{settings.AI_ENGINE_URL}/api/v1/routing/",
        json={
            "userId": str(user_id),
            "conversationId": f"webapp_{user_id}",
            "platform": "telegram",
            "origin": {
                "latitude": origin["lat"],
                "longitude": origin["lng"]
            },
            "destination": {
                "latitude": destination["lat"],
                "longitude": destination["lng"]
            }
        },
        headers={"x-internal-api-key": settings.INTERNAL_API_KEY}
    )
    
    if response.status_code == 200 or response.status_code == 202:
        # Clear any old job result to prevent stale data
        if hasattr(request.app.state, 'job_results') and f"job_{user_id}" in request.app.state.job_results:
            del request.app.state.job_results[f"job_{user_id}"]
            
        return {"status": "accepted", "job_id": f"job_{user_id}"} 
    
    raise HTTPException(status_code=500, detail="Failed to contact AI Engine")

@router.get("/job/{job_id}")
async def get_job_status(job_id: str, request: Request, user: dict = Depends(get_current_user)):
    """
    Poll this API to get routing result.
    Result should be cached in app state or Redis when internal.py receives the webhook.
    """
    # For now, we will use a simple in-memory dict attached to app state to store job results.
    # In production, use Redis.
    job_results = getattr(request.app.state, 'job_results', {})
    
    if job_id in job_results:
        return {"status": "completed", "result": job_results[job_id]}
    
    return {"status": "pending"}
