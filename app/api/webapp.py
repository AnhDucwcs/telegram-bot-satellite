from fastapi import APIRouter, Request, HTTPException, Header, Depends
import hmac
import hashlib
import pytz
from urllib.parse import parse_qsl
from typing import Optional
from app.core.config import settings
from app.services.history import HistoryService
from app.core.limiter import limiter

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

import time
_places_cache = {}

@router.get("/places/search")
@limiter.limit("20/minute")
async def search_places(q: str, request: Request, user: dict = Depends(get_current_user)):
    """Proxy API to search places via Geoapify"""
    if not q or len(q) < 2:
        return {"features": []}
    
    now = time.time()
    cache_key = q.lower().strip()
    if cache_key in _places_cache:
        cached_data, timestamp = _places_cache[cache_key]
        if now - timestamp < 3600:
            return cached_data
            
    if len(_places_cache) > 1000:
        _places_cache.clear()
        
    ai_client = request.app.state.ai_client
    url = f"https://api.geoapify.com/v1/geocode/autocomplete?text={q}&format=json&apiKey={settings.GEOAPIFY_API_KEY}&filter=countrycode:vn"
    
    response = await ai_client.client.get(url)
    if response.status_code == 200:
        data = response.json()
        features = []
        for result in data.get("results", []):
            name = result.get("name") or result.get("street") or result.get("city")
            if not name:
                name = result.get("formatted", "Unknown Location")
                
            features.append({
                "properties": {
                    "name": name,
                    "street": result.get("street", ""),
                    "district": result.get("suburb") or result.get("county") or result.get("district") or "",
                    "city": result.get("city") or result.get("state") or ""
                },
                "geometry": {
                    "coordinates": [result.get("lon"), result.get("lat")]
                }
            })
            
        result_payload = {"features": features}
        _places_cache[cache_key] = (result_payload, now)
        return result_payload
        
    # Fallback to free Photon API if Geoapify hits rate limit (429/403) or errors out
    try:
        photon_url = f"https://photon.komoot.io/api/?q={q}&lat=10.7769&lon=106.7009&limit=5"
        photon_response = await ai_client.client.get(photon_url)
        if photon_response.status_code == 200:
            data = photon_response.json()
            result_payload = {"features": data.get("features", [])}
            _places_cache[cache_key] = (result_payload, now)
            return result_payload
    except Exception:
        pass
        
    raise HTTPException(status_code=500, detail="Geocoding API failed")

@router.get("/history/locations")
@limiter.limit("15/10minutes")
async def get_recent_locations(request: Request, user: dict = Depends(get_current_user)):
    user_id = user["id"]
    locations = await HistoryService.get_recent_locations(user_id)
    return {"status": "ok", "locations": locations}

@router.get("/history/routes")
@limiter.limit("15/10minutes")
async def get_recent_routes(request: Request, user: dict = Depends(get_current_user)):
    user_id = user["id"]
    routes = await HistoryService.get_recent_routes(user_id)
    return {"status": "ok", "routes": routes}

@router.post("/history/route")
@limiter.limit("15/10minutes")
async def save_recent_route(payload: dict, request: Request, user: dict = Depends(get_current_user)):
    """Save a route to history when user starts navigation explicitly"""
    user_id = user["id"]
    origin = payload.get("origin")
    destination = payload.get("destination")
    if origin and destination:
        await HistoryService.add_recent_route(user_id, origin, destination)
    return {"status": "ok"}

@router.post("/history/location")
@limiter.limit("15/10minutes")
async def save_location(location: dict, request: Request, user: dict = Depends(get_current_user)):
    """Save a single location when user searches for it"""
    user_id = user["id"]
    await HistoryService.add_recent_location(user_id, location)
    return {"status": "ok"}

@router.post("/route")
@limiter.limit("15/10minutes")
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

@router.get("/traffic-layer")
@limiter.limit("30/minute")
async def get_traffic_layer(
    request: Request,
    bbox: str,
    user: dict = Depends(get_current_user)
):
    """
    Proxy traffic layer requests to backend with bbox.
    Format of bbox string: min_lng,min_lat,max_lng,max_lat
    """
    ai_client = request.app.state.ai_client
    
    try:
        min_lng, min_lat, max_lng, max_lat = map(float, bbox.split(','))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid bbox format")
        
    url = f"{settings.AI_ENGINE_URL}/api/v1/traffic-layer/?min_lng={min_lng}&min_lat={min_lat}&max_lng={max_lng}&max_lat={max_lat}"
    
    headers = {
        "x-internal-api-key": settings.INTERNAL_API_KEY
    }
    
    response = await ai_client.client.get(url, headers=headers)
    if response.status_code == 200:
        return response.json()
        
    raise HTTPException(status_code=response.status_code, detail="Failed to get traffic layer")


@router.get("/job/{job_id}")
@limiter.limit("30/minute")
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

@router.post("/trip-completed")
@limiter.limit("5/minute")
async def trip_completed(payload: dict, request: Request, user: dict = Depends(get_current_user)):
    """
    Send trip statistics to user via Telegram upon destination reached.
    """
    user_id = user["id"]
    chat_id = int(user_id) if user_id else None
    
    if not chat_id:
        return {"status": "error", "message": "No valid user id"}
        
    origin_name = payload.get("origin_name", "Vị trí bắt đầu")
    destination_name = payload.get("destination_name", "Vị trí kết thúc")
    distance_km = payload.get("distance_km", "0")
    
    estimated_time = payload.get("estimated_time_min", 0)
    total_time = payload.get("total_time_min", 0)
    away_time = payload.get("away_time_min", 0)
    display_time = payload.get("display_time_min", 0)
    
    # Calculate speed and deviation
    import datetime
    nav_start_time_ms = payload.get("nav_start_time")
    if nav_start_time_ms:
        try:
            start_dt = datetime.datetime.fromtimestamp(nav_start_time_ms / 1000.0, tz=pytz.timezone('Asia/Ho_Chi_Minh'))
            nav_start_str = start_dt.strftime("%H:%M")
        except Exception:
            nav_start_str = "?"
    else:
        nav_start_str = "?"
        
    current_time = datetime.datetime.now(pytz.timezone('Asia/Ho_Chi_Minh')).strftime("%H:%M")
    
    dev_text = ""
    if total_time < estimated_time:
        dev_text = f" (Nhanh hơn dự kiến {estimated_time - total_time} phút)"
    elif total_time > estimated_time:
        dev_text = f" (Chậm hơn dự kiến {total_time - estimated_time} phút)"
    else:
        dev_text = " (Đúng như dự kiến)"
        
    try:
        avg_speed = round(float(distance_km) / (total_time / 60), 1) if total_time > 0 else 0
    except:
        avg_speed = 0
    
    telegram_bot = request.app.state.telegram_bot
    text = (
        f"<b>✅ Chuyến đi hoàn tất ({nav_start_str}-{current_time})</b>\n\n"
        f"<b>Lộ trình:</b>\n"
        f"• Từ: {origin_name}\n"
        f"• Đến: {destination_name}\n\n"
        f"<b>Thống kê chuyến đi:</b>\n"
        f"• Quãng đường: {distance_km} km\n"
        f"• Tổng thời gian: {total_time} phút{dev_text}\n"
        f"• Vận tốc trung bình: {avg_speed} km/h\n\n"
        f"<b>Chi tiết ứng dụng:</b>\n"
        f"• Thời gian hiển thị bản đồ: {display_time} phút\n"
    )
    if away_time >= 1:
        text += f"• Thời gian chạy ngầm/tắt app: {away_time} phút\n"
    
    try:
        await telegram_bot.bot.send_message(chat_id=chat_id, text=text, parse_mode="HTML")
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.post("/report-traffic")
@limiter.limit("5/minute")
async def report_traffic(payload: dict, request: Request, user: dict = Depends(get_current_user)):
    """
    Proxy API to report traffic jam to the routing engine.
    """
    user_id = user["id"]
    lat = payload.get("lat")
    lng = payload.get("lng")
    severity = payload.get("severity")
    
    if lat is None or lng is None or not severity:
        raise HTTPException(status_code=400, detail="Thiếu trường dữ liệu: lat, lng, severity")
        
    ai_client = request.app.state.ai_client
    response = await ai_client.client.post(
        f"{settings.AI_ENGINE_URL}/api/v1/report/",
        json={
            "user_id": str(user_id),
            "lat": lat,
            "lng": lng,
            "severity": severity
        },
        headers={"x-internal-api-key": settings.INTERNAL_API_KEY}
    )
    
    if response.status_code == 200:
        return response.json()
    else:
        # Bóc tách lỗi từ AI Engine để hiển thị thân thiện trên UI
        try:
            error_data = response.json()
            error_detail = error_data.get("detail", response.text)
        except:
            error_detail = response.text
        raise HTTPException(status_code=response.status_code, detail=error_detail)
