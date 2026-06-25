// Init Telegram Web App
const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

// Map Initialization
let map = L.map('map', {
    zoomControl: false,
    attributionControl: false
}).setView([10.7769, 106.7009], 14); // Default to HCMC

L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 20
}).addTo(map);

// Variables
let currentOrigin = null;
let currentDestination = null;
let originMarker = null;
let destMarker = null;
let routePolyline = null;
let currentRouteGeoJSON = null;

// DOM Elements
const inputOrigin = document.getElementById('input-origin');
const inputDestination = document.getElementById('input-destination');
const suggestionsBox = document.getElementById('suggestions-box');
const recentRoutesBox = document.getElementById('recent-routes-box');
const recentRoutesList = document.getElementById('recent-routes-list');
const actionButtons = document.getElementById('action-buttons');
const loadingScreen = document.getElementById('loading-screen');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadRecentRoutes();
    setupInputs();
});

// Setup input interactions
function setupInputs() {
    inputOrigin.addEventListener('focus', () => handleInputFocus('origin'));
    inputDestination.addEventListener('focus', () => handleInputFocus('destination'));
    
    let debounceTimer;
    inputOrigin.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => searchLocation(e.target.value, 'origin'), 500);
    });
    
    inputDestination.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => searchLocation(e.target.value, 'destination'), 500);
    });
}

function clearInput(type) {
    if (type === 'origin') {
        inputOrigin.value = '';
        currentOrigin = null;
        if (originMarker) map.removeLayer(originMarker);
    } else {
        inputDestination.value = '';
        currentDestination = null;
        if (destMarker) map.removeLayer(destMarker);
    }
    checkAndShowButtons();
    suggestionsBox.classList.add('hidden');
    recentRoutesBox.classList.remove('hidden');
}

async function handleInputFocus(type) {
    // Hide recent routes
    recentRoutesBox.classList.add('hidden');
    suggestionsBox.classList.remove('hidden');
    suggestionsBox.innerHTML = '<div class="empty-state">Đang tải địa điểm gần đây...</div>';
    
    try {
        const res = await fetch('/api/v1/webapp/history/locations', {
            headers: { 'x-telegram-init-data': tg.initData }
        });
        const data = await res.json();
        
        if (data.locations) {
            suggestionsBox.innerHTML = `
                <div class="suggestion-item" onclick="useMyLocation('${type}')">
                    <div class="item-icon" style="color:var(--accent-primary)">📍</div>
                    <div class="item-details"><div class="item-title">Vị trí của tôi</div></div>
                </div>
                <div class="suggestion-item" onclick="openMapPicker('${type}')">
                    <div class="item-icon" style="color:var(--accent-primary)">🗺️</div>
                    <div class="item-details"><div class="item-title">Chọn trên bản đồ</div></div>
                </div>
            `;
            if (data.locations.length > 0) {
                data.locations.forEach(loc => {
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.innerHTML = `
                    <div class="item-icon">🕒</div>
                    <div class="item-details">
                        <div class="item-title">${loc.name}</div>
                        <div class="item-subtitle">${loc.address || ''}</div>
                    </div>
                `;
                div.onclick = () => selectLocation(loc, type);
                suggestionsBox.appendChild(div);
            });
        } else {
            suggestionsBox.innerHTML = '<div class="empty-state">Nhập địa điểm để tìm kiếm</div>';
        }
    } catch (e) {
        suggestionsBox.innerHTML = '<div class="empty-state">Không thể tải lịch sử</div>';
    }
}

// Search using Photon Komoot API
async function searchLocation(query, type) {
    if (!query || query.length < 2) {
        handleInputFocus(type);
        return;
    }
    
    try {
        const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=10.7769&lon=106.7009&limit=5`);
        const data = await res.json();
        
        suggestionsBox.innerHTML = '';
        if (data.features && data.features.length > 0) {
            data.features.forEach(f => {
                const name = f.properties.name || f.properties.street || f.properties.city;
                const address = [f.properties.street, f.properties.district, f.properties.city].filter(Boolean).join(', ');
                const lat = f.geometry.coordinates[1];
                const lng = f.geometry.coordinates[0];
                
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.innerHTML = `
                    <div class="item-icon">📍</div>
                    <div class="item-details">
                        <div class="item-title">${name}</div>
                        <div class="item-subtitle">${address}</div>
                    </div>
                `;
                div.onclick = () => selectLocation({name, lat, lng, address}, type);
                suggestionsBox.appendChild(div);
            });
        } else {
            suggestionsBox.innerHTML = '<div class="empty-state">Không tìm thấy kết quả</div>';
        }
    } catch (e) {
        console.error(e);
    }
}

function selectLocation(loc, type) {
    suggestionsBox.classList.add('hidden');
    recentRoutesBox.classList.remove('hidden');
    
    if (type === 'origin') {
        inputOrigin.value = loc.name;
        currentOrigin = loc;
        if (originMarker) map.removeLayer(originMarker);
        originMarker = L.circleMarker([loc.lat, loc.lng], {color: '#10b981', radius: 8, fillOpacity: 1}).addTo(map);
        map.setView([loc.lat, loc.lng], 15);
    } else {
        inputDestination.value = loc.name;
        currentDestination = loc;
        if (destMarker) map.removeLayer(destMarker);
        destMarker = L.circleMarker([loc.lat, loc.lng], {color: '#ef4444', radius: 8, fillOpacity: 1}).addTo(map);
        map.setView([loc.lat, loc.lng], 15);
    }
    
    // Save to history silently
    fetch('/api/v1/webapp/history/location', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-telegram-init-data': tg.initData
        },
        body: JSON.stringify(loc)
    }).catch(console.error);
    
    checkAndShowButtons();
}

function checkAndShowButtons() {
    if (currentOrigin && currentDestination) {
        actionButtons.classList.remove('hidden');
        recentRoutesBox.classList.add('hidden');
        
        // Fit bounds
        const bounds = L.latLngBounds([
            [currentOrigin.lat, currentOrigin.lng],
            [currentDestination.lat, currentDestination.lng]
        ]);
        map.fitBounds(bounds, {padding: [50, 50]});
    } else {
        actionButtons.classList.add('hidden');
    }
}

async function loadRecentRoutes() {
    try {
        const res = await fetch('/api/v1/webapp/history/routes', {
            headers: { 'x-telegram-init-data': tg.initData }
        });
        const data = await res.json();
        
        if (data.routes && data.routes.length > 0) {
            recentRoutesList.innerHTML = '';
            data.routes.forEach(route => {
                const div = document.createElement('div');
                div.className = 'recent-route-item';
                div.innerHTML = `
                    <div class="item-icon">🛣️</div>
                    <div class="item-details">
                        <div class="item-title">${route.origin.name} ➔ ${route.destination.name}</div>
                        <div class="item-subtitle">Chạm để tìm đường</div>
                    </div>
                `;
                div.onclick = () => {
                    selectLocation(route.origin, 'origin');
                    selectLocation(route.destination, 'destination');
                    calculateRoute();
                };
                recentRoutesList.appendChild(div);
            });
        } else {
            recentRoutesList.innerHTML = '<div class="empty-state">Chưa có lịch sử tìm kiếm</div>';
        }
    } catch (e) {
        console.error("Failed to load history");
    }
}

// ==========================================
// Map Picker & My Location Logic
// ==========================================

let mapPickerMode = null; // 'origin' or 'destination'
const mapPickerUI = document.getElementById('map-picker-ui');

function openMapPicker(type) {
    suggestionsBox.classList.add('hidden');
    document.querySelector('.search-panel').classList.add('hidden');
    mapPickerUI.classList.remove('hidden');
    mapPickerMode = type;
}

document.getElementById('btn-cancel-picker').addEventListener('click', () => {
    mapPickerUI.classList.add('hidden');
    document.querySelector('.search-panel').classList.remove('hidden');
    mapPickerMode = null;
});

document.getElementById('btn-confirm-location').addEventListener('click', async () => {
    mapPickerUI.classList.add('hidden');
    document.querySelector('.search-panel').classList.remove('hidden');
    
    const center = map.getCenter();
    const lat = center.lat;
    const lng = center.lng;
    
    let name = "Vị trí đã chọn";
    try {
        const res = await fetch(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`);
        const data = await res.json();
        if (data.features && data.features.length > 0) {
            const p = data.features[0].properties;
            name = p.name || p.street || "Vị trí đã chọn";
        }
    } catch(e) {}
    
    selectLocation({name, lat, lng}, mapPickerMode);
    mapPickerMode = null;
});

function useMyLocation(type) {
    suggestionsBox.innerHTML = '<div class="empty-state">Đang lấy vị trí...</div>';
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition((position) => {
            const { latitude, longitude } = position.coords;
            selectLocation({name: "Vị trí của tôi", lat: latitude, lng: longitude}, type);
        }, () => {
            alert("Không thể lấy vị trí. Vui lòng cấp quyền GPS.");
            suggestionsBox.classList.add('hidden');
        }, { enableHighAccuracy: true });
    } else {
        alert("Trình duyệt không hỗ trợ GPS.");
    }
}

// ==========================================
// Routing Logic (Polling)
// ==========================================

document.getElementById('btn-show-route').addEventListener('click', calculateRoute);
document.getElementById('btn-navigate').addEventListener('click', () => {
    calculateRoute(true);
});

async function calculateRoute(startNavigation = false) {
    if (!currentOrigin || !currentDestination) return;
    
    loadingScreen.classList.remove('hidden');
    
    try {
        // 1. Create Job
        const res = await fetch('/api/v1/webapp/route', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-telegram-init-data': tg.initData
            },
            body: JSON.stringify({
                origin: currentOrigin,
                destination: currentDestination
            })
        });
        const data = await res.json();
        
        if (data.status === 'accepted' && data.job_id) {
            pollJobStatus(data.job_id, startNavigation);
        } else {
            throw new Error("Failed to start job");
        }
    } catch (e) {
        console.error(e);
        loadingScreen.classList.add('hidden');
        alert("Lỗi khi kết nối đến máy chủ tính đường.");
    }
}

async function pollJobStatus(jobId, startNavigation) {
    const maxRetries = 30; // Max 60 seconds
    let retries = 0;
    
    const interval = setInterval(async () => {
        retries++;
        if (retries > maxRetries) {
            clearInterval(interval);
            loadingScreen.classList.add('hidden');
            alert("Quá thời gian chờ tính đường.");
            return;
        }
        
        try {
            const res = await fetch(`/api/v1/webapp/job/${jobId}`, {
                headers: { 'x-telegram-init-data': tg.initData }
            });
            const data = await res.json();
            
            if (data.status === 'completed') {
                clearInterval(interval);
                handleRouteResult(data.result, startNavigation);
            } else if (data.status === 'error') {
                clearInterval(interval);
                loadingScreen.classList.add('hidden');
                alert(data.message || "Không tìm thấy đường.");
            }
        } catch (e) {
            console.error("Polling error", e);
        }
    }, 2000);
}

function handleRouteResult(result, startNavigation) {
    loadingScreen.classList.add('hidden');
    
    if (routePolyline) map.removeLayer(routePolyline);
    
    currentRouteGeoJSON = result.geojson;
    
    routePolyline = L.geoJSON(currentRouteGeoJSON, {
        style: { color: '#3b82f6', weight: 6, opacity: 0.8 }
    }).addTo(map);
    
    map.fitBounds(routePolyline.getBounds(), {padding: [30, 30]});
    
    // Hide UI
    document.querySelector('.search-panel').classList.add('hidden');
    
    if (startNavigation) {
        startNavMode();
    }
}

// ==========================================
// Navigation Logic (Screen 2)
// ==========================================

let watchId = null;
let routeSegments = [];
let currentSegmentIndex = 0;
let userMarker = null;

function startNavMode() {
    document.getElementById('screen-search').classList.remove('active');
    document.getElementById('screen-navigation').classList.remove('hidden');
    document.getElementById('screen-navigation').classList.add('active');
    
    tg.HapticFeedback.notificationOccurred('success');
    
    // Initialize Queue
    initRouteSegments();
    
    // Start GPS Watch
    if ("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition(handlePositionUpdate, handlePositionError, {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000
        });
    } else {
        alert("Trình duyệt không hỗ trợ GPS.");
    }
}

function initRouteSegments() {
    if (!currentRouteGeoJSON) return;
    
    routeSegments = [];
    currentSegmentIndex = 0;
    
    // Extract coordinates. Note: GeoJSON stores as [lng, lat]
    const coords = currentRouteGeoJSON.features[0].geometry.coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
        routeSegments.push({
            start: L.latLng(coords[i][1], coords[i][0]),
            end: L.latLng(coords[i+1][1], coords[i+1][0])
        });
    }
}

function handlePositionUpdate(position) {
    const { latitude, longitude, heading } = position.coords;
    const userLatLng = L.latLng(latitude, longitude);
    
    // Update marker
    if (!userMarker) {
        userMarker = L.circleMarker(userLatLng, {
            color: '#3b82f6',
            fillColor: '#60a5fa',
            fillOpacity: 1,
            radius: 8,
            weight: 3
        }).addTo(map);
    } else {
        userMarker.setLatLng(userLatLng);
    }
    
    // Auto-center map if in lock mode
    map.setView(userLatLng, 18);
    
    // Map Matching (Queue-based logic)
    if (routeSegments.length === 0) return;
    
    let activeSegment = routeSegments[currentSegmentIndex];
    let distanceToSegment = getDistanceToSegment(userLatLng, activeSegment.start, activeSegment.end);
    
    // Check if user passed the end of the current segment
    const distToEnd = map.distance(userLatLng, activeSegment.end);
    const segmentLength = map.distance(activeSegment.start, activeSegment.end);
    
    // Very simple check: If we are closer to the next segment's start (which is activeSegment.end)
    // than the length of the segment, and we've moved past it
    // A proper projection check is better, but here's a simplified version:
    if (distToEnd < 20 && currentSegmentIndex < routeSegments.length - 1) {
        currentSegmentIndex++; // Pop active segment
        activeSegment = routeSegments[currentSegmentIndex];
        distanceToSegment = getDistanceToSegment(userLatLng, activeSegment.start, activeSegment.end);
    }
    
    // Off-route detection
    if (distanceToSegment > 40) {
        // Trigger Re-routing
        showToast("Lệch tuyến! Đang tính lại...");
        tg.HapticFeedback.notificationOccurred('warning');
        
        // Stop current watch
        navigator.geolocation.clearWatch(watchId);
        
        // Use current GPS as new origin
        currentOrigin = {
            name: "Vị trí hiện tại",
            lat: latitude,
            lng: longitude
        };
        
        // Trigger route recalculation silently
        calculateRoute(true);
    }
}

function getDistanceToSegment(p, p1, p2) {
    // Math logic to find shortest distance from point p to line segment p1-p2
    // Simplified using Leaflet's built-in map.distance for rough approximation
    // A true cross-track distance algorithm should be here
    const d1 = map.distance(p, p1);
    const d2 = map.distance(p, p2);
    const L2 = map.distance(p1, p2);
    
    if (L2 === 0) return d1;
    
    const t = ((p.lat - p1.lat) * (p2.lat - p1.lat) + (p.lng - p1.lng) * (p2.lng - p1.lng)) / (L2 * L2);
    const t_clamped = Math.max(0, Math.min(1, t));
    
    const projection = L.latLng(
        p1.lat + t_clamped * (p2.lat - p1.lat),
        p1.lng + t_clamped * (p2.lng - p1.lng)
    );
    
    return map.distance(p, projection);
}

function handlePositionError(err) {
    console.warn('ERROR(' + err.code + '): ' + err.message);
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

document.getElementById('btn-stop-nav').addEventListener('click', () => {
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    if (userMarker) {
        map.removeLayer(userMarker);
        userMarker = null;
    }
    
    document.getElementById('screen-navigation').classList.remove('active');
    document.getElementById('screen-navigation').classList.add('hidden');
    document.getElementById('screen-search').classList.add('active');
    document.querySelector('.search-panel').classList.remove('hidden');
    
    if (routePolyline) map.removeLayer(routePolyline);
});
