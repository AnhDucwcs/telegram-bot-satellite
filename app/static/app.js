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
let globalLocationMarker = null;

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
    initTheme();
    loadRecentRoutes();
    setupInputs();
    
    // Auto-center map on load and start global tracking
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition((pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const userLatLng = L.latLng(lat, lng);
            
            if (!globalLocationMarker) {
                globalLocationMarker = L.circleMarker(userLatLng, {
                    color: 'white', fillColor: '#3b82f6', fillOpacity: 1, radius: 10, weight: 3
                }).addTo(map);
                map.setView(userLatLng, 17); // Zoom closer
                document.getElementById('btn-my-location-fab').classList.remove('hidden');
            } else {
                globalLocationMarker.setLatLng(userLatLng);
                globalLocationMarker.bringToFront(); // Keep on top
            }
        }, () => {}, { enableHighAccuracy: true, maximumAge: 10000 });
    }
    
    document.getElementById('btn-my-location-fab').addEventListener('click', () => {
        if (globalLocationMarker) {
            map.setView(globalLocationMarker.getLatLng(), 17);
        } else if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition((pos) => {
                map.setView([pos.coords.latitude, pos.coords.longitude], 17);
            });
        }
    });
    
    document.getElementById('btn-start-nav-from-info').addEventListener('click', () => {
        startNavMode();
    });
    
    document.getElementById('btn-cancel-route').addEventListener('click', () => {
        resetApp();
    });
    
    document.getElementById('btn-toggle-search').addEventListener('click', (e) => {
        const panel = document.querySelector('.search-panel');
        panel.classList.toggle('collapsed');
        e.target.textContent = panel.classList.contains('collapsed') ? '▶️' : '🔽';
    });
});

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
    } else if (!savedTheme && tg.colorScheme === 'light') {
        // Fallback to telegram theme if no local preference
        document.body.classList.add('light-mode');
    }
    
    document.getElementById('btn-theme-toggle').addEventListener('click', () => {
        document.body.classList.toggle('light-mode');
        const isLight = document.body.classList.contains('light-mode');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
    });
}

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
    
    // Hide suggestions when clicking outside
    document.addEventListener('click', (e) => {
        const searchPanel = document.querySelector('.search-panel');
        if (searchPanel && !searchPanel.contains(e.target) && !mapPickerUI.contains(e.target)) {
            suggestionsBox.classList.add('hidden');
            if (!currentOrigin || !currentDestination) {
                recentRoutesBox.classList.remove('hidden');
            }
        }
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
    
    document.getElementById('route-info-box').classList.add('hidden');
    if (routePolyline) {
        map.removeLayer(routePolyline);
        routePolyline = null;
    }
    
    checkAndShowButtons();
    suggestionsBox.classList.add('hidden');
    recentRoutesBox.classList.remove('hidden');
}

function resetApp() {
    clearInput('origin');
    clearInput('destination');
    if (globalLocationMarker) {
        map.setView(globalLocationMarker.getLatLng(), 17);
    }
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
            }
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
    
    // Clear old route line if exists to prevent visual mismatch
    if (routePolyline) {
        map.removeLayer(routePolyline);
        routePolyline = null;
        document.getElementById('route-info-box').classList.add('hidden');
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
        document.getElementById('route-info-box').classList.add('hidden');
        
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
    if (globalLocationMarker) {
        const lat = globalLocationMarker.getLatLng().lat;
        const lng = globalLocationMarker.getLatLng().lng;
        fetchAndSelectLocation(lat, lng, type);
        return;
    }
    
    suggestionsBox.innerHTML = '<div class="empty-state">Đang lấy vị trí...</div>';
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition((position) => {
            const { latitude, longitude } = position.coords;
            fetchAndSelectLocation(latitude, longitude, type);
        }, () => {
            alert("Không thể lấy vị trí. Vui lòng cấp quyền GPS.");
            suggestionsBox.classList.add('hidden');
        }, { enableHighAccuracy: true });
    } else {
        alert("Trình duyệt không hỗ trợ GPS.");
    }
}

async function fetchAndSelectLocation(lat, lng, type) {
    suggestionsBox.innerHTML = '<div class="empty-state">Đang lấy địa chỉ...</div>';
    let name = "Vị trí của tôi";
    let address = "";
    try {
        const res = await fetch(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`);
        const data = await res.json();
        if (data.features && data.features.length > 0) {
            const p = data.features[0].properties;
            name = p.name || p.street || "Vị trí của tôi";
            address = [p.district, p.city].filter(Boolean).join(', ');
        }
    } catch(e) {}
    selectLocation({name, lat, lng, address}, type);
}

// ==========================================
// Routing Logic (Polling)
// ==========================================

document.getElementById('btn-show-route').addEventListener('click', () => calculateRoute(false));
document.getElementById('btn-navigate').addEventListener('click', () => {
    calculateRoute(true);
});

async function calculateRoute(startNavigation = false, isReroute = false) {
    if (!currentOrigin || !currentDestination) return;
    
    // Reuse existing route if already calculated to save time
    if (startNavigation && currentRouteGeoJSON && !isReroute) {
        document.querySelector('.search-panel').classList.add('hidden');
        startNavMode();
        return;
    }
    
    if (!isReroute) {
        loadingScreen.classList.remove('hidden');
    }
    
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
                destination: currentDestination,
                is_reroute: isReroute
            })
        });
        const data = await res.json();
        
        if (data.status === 'accepted' && data.job_id) {
            return pollJobStatus(data.job_id, startNavigation);
        } else {
            throw new Error("Failed to start job");
        }
    } catch (e) {
        console.error(e);
        loadingScreen.classList.add('hidden');
        alert("Lỗi khi kết nối đến máy chủ tính đường.");
    }
}

function pollJobStatus(jobId, startNavigation) {
    const maxRetries = 30; // Max 60 seconds
    let retries = 0;
    
    return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
            retries++;
            if (retries > maxRetries) {
                clearInterval(interval);
                loadingScreen.classList.add('hidden');
                alert("Quá thời gian chờ tính đường.");
                reject(new Error("Timeout"));
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
                    resolve();
                } else if (data.status === 'error') {
                    clearInterval(interval);
                    loadingScreen.classList.add('hidden');
                    alert(data.message || "Không tìm thấy đường.");
                    reject(new Error(data.message));
                }
            } catch (e) {
                console.error("Polling error", e);
            }
        }, 2000);
    });
}

function handleRouteResult(result, startNavigation) {
    loadingScreen.classList.add('hidden');
    
    if (routePolyline) map.removeLayer(routePolyline);
    
    currentRouteGeoJSON = result.geojson;
    
    routePolyline = L.geoJSON(currentRouteGeoJSON, {
        style: { color: '#3b82f6', weight: 6, opacity: 0.8 }
    }).addTo(map);
    if (!isNavigating) {
        map.fitBounds(routePolyline.getBounds(), {padding: [30, 30]});
    } else {
        // If re-routing, auto-recenter (activate "Ghim") instead of showing the whole route
        isFollowing = true;
        if (globalLocationMarker) {
            map.setView(globalLocationMarker.getLatLng(), 17);
        }
    }
    
    // Set ETA and distance globally for both screens
    const etaText = result.estimated_time_min ? `${Math.ceil(result.estimated_time_min)} phút` : '-- phút';
    const distText = result.distance_km ? `${result.distance_km.toFixed(1)} km` : '-- km';
    
    document.getElementById('info-eta').textContent = etaText;
    document.getElementById('info-dist').textContent = distText;
    document.getElementById('nav-eta').textContent = etaText;
    document.getElementById('nav-total-dist').textContent = distText;
    
    if (startNavigation) {
        document.querySelector('.search-panel').classList.add('hidden');
        if (!isNavigating) {
            startNavMode();
        } else {
            // Already navigating (Re-routing case)
            initRouteSegments();
        }
    } else {
        // Show info on screen 1
        actionButtons.classList.add('hidden');
        document.getElementById('route-info-box').classList.remove('hidden');
    }
}

// ==========================================
// Navigation Logic (Screen 2)
// ==========================================

let watchId = null;
let routeSegments = [];
let currentSegmentIndex = 0;
let isFollowing = true; // Auto-track user position
let isRerouting = false; // Prevent re-routing spam
let isNavigating = false; // Track if we are in navigation mode
let lastRerouteTime = 0; // Debounce re-routing

function startNavMode() {
    if (isNavigating) return;
    isNavigating = true;
    
    document.getElementById('screen-search').classList.remove('active');
    document.getElementById('screen-navigation').classList.remove('hidden');
    document.getElementById('screen-navigation').classList.add('active');
    document.querySelector('.search-panel').classList.add('hidden');
    
    tg.HapticFeedback.notificationOccurred('success');
    
    // Make sure blue dot is visible
    if (globalLocationMarker) {
        globalLocationMarker.setStyle({opacity: 1, fillOpacity: 1});
    }
    
    // Enable following mode
    isFollowing = true;
    
    // Zoom immediately to current location
    if (globalLocationMarker) {
        map.setView(globalLocationMarker.getLatLng(), 17);
    }
    
    // Initialize Queue
    initRouteSegments();
    
    // Start GPS Watch (real GPS updates will move the arrow)
    if ("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition(handlePositionUpdate, handlePositionError, {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000
        });
    }
    
    // When user manually drags the map, disable following
    map.on('dragstart', () => {
        isFollowing = false;
    });
}

function initRouteSegments() {
    if (!currentRouteGeoJSON) return;
    
    routeSegments = [];
    currentSegmentIndex = 0;
    
    try {
        let coords = [];
        if (currentRouteGeoJSON.type === 'FeatureCollection') {
            coords = currentRouteGeoJSON.features[0].geometry.coordinates;
        } else if (currentRouteGeoJSON.type === 'LineString') {
            coords = currentRouteGeoJSON.coordinates;
        } else if (currentRouteGeoJSON.type === 'Feature') {
            coords = currentRouteGeoJSON.geometry.coordinates;
        }
        
        if (coords && coords.length > 0) {
            for (let i = 0; i < coords.length - 1; i++) {
                routeSegments.push({
                    start: L.latLng(coords[i][1], coords[i][0]),
                    end: L.latLng(coords[i+1][1], coords[i+1][0])
                });
            }
        }
    } catch (e) {
        console.error("Lỗi parse GeoJSON:", e);
    }
}

function handlePositionUpdate(position) {
    const { latitude, longitude } = position.coords;
    const userLatLng = L.latLng(latitude, longitude);
    
    // Update blue dot marker
    if (globalLocationMarker) {
        globalLocationMarker.setLatLng(userLatLng);
        globalLocationMarker.bringToFront();
    }
    
    // Auto-center map if following
    if (isFollowing) {
        map.setView(userLatLng, map.getZoom());
    }
    
    // Map Matching (Find closest segment)
    if (routeSegments.length === 0 || isRerouting) return;
    
    let minDistance = Infinity;
    let closestIndex = currentSegmentIndex;
    
    // Check current segment and next 10 segments to see if we moved forward
    const maxCheck = Math.min(routeSegments.length, currentSegmentIndex + 10);
    for (let i = currentSegmentIndex; i < maxCheck; i++) {
        const seg = routeSegments[i];
        const dist = getDistanceToSegment(userLatLng, seg.start, seg.end);
        if (dist < minDistance) {
            minDistance = dist;
            closestIndex = i;
        }
    }
    
    // Advance progress
    if (closestIndex > currentSegmentIndex) {
        currentSegmentIndex = closestIndex;
    }
    
    // Debug info
    const debugEl = document.getElementById('sim-debug');
    if (debugEl) {
        debugEl.textContent = `Dist: ${Math.round(minDistance)}m | Seg: ${currentSegmentIndex}/${routeSegments.length}`;
    }
    
    // Off-route detection: re-route if we are > 50m away from the closest valid segment
    const now = Date.now();
    if (minDistance > 50 && (now - lastRerouteTime > 15000)) { // 15 seconds cooldown
        isRerouting = true;
        lastRerouteTime = now;
        showToast("Lệch tuyến! Đang tính lại...");
        tg.HapticFeedback.notificationOccurred('warning');
        
        // Use current GPS as new origin
        currentOrigin = {
            name: "Vị trí hiện tại",
            lat: latitude,
            lng: longitude
        };
        
        // Clear cached route so calculateRoute actually calls the API
        currentRouteGeoJSON = null;
        
        // Trigger route recalculation (isReroute = true)
        calculateRoute(true, true).then(() => {
            isRerouting = false;
        }).catch(() => {
            isRerouting = false;
        });
    }
}

function getDistanceToSegment(p, p1, p2) {
    const x = p.lng, y = p.lat;
    const x1 = p1.lng, y1 = p1.lat;
    const x2 = p2.lng, y2 = p2.lat;
    
    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    
    const dot = A * C + B * D;
    const len_sq = C * C + D * D;
    
    let param = -1;
    if (len_sq !== 0) param = dot / len_sq;
    
    let xx, yy;
    if (param < 0) {
        xx = x1; yy = y1;
    } else if (param > 1) {
        xx = x2; yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }
    
    return map.distance(L.latLng(y, x), L.latLng(yy, xx));
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

function stopNavMode() {
    isNavigating = false;
    isRerouting = false;
    
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    
    // Stop simulator if running
    stopSimulator();
    
    // Remove drag listener
    map.off('dragstart');
    
    document.getElementById('screen-navigation').classList.remove('active');
    document.getElementById('screen-navigation').classList.add('hidden');
    document.getElementById('screen-search').classList.add('active');
    document.querySelector('.search-panel').classList.remove('hidden');
    
    resetApp();
}

document.getElementById('btn-stop-nav').addEventListener('click', stopNavMode);

document.getElementById('btn-recenter').addEventListener('click', () => {
    isFollowing = true;
    if (globalLocationMarker) {
        map.setView(globalLocationMarker.getLatLng(), 17);
    }
});


// ==========================================
// GPS Simulator (Debug/Test Mode)
// ==========================================
// Activate: press 'G' key on keyboard
// WASD: move position | ArrowLeft/ArrowRight: rotate heading
// The simulator feeds fake GPS coords into handlePositionUpdate()
// so all real logic (re-routing, ETA, map rotation) works identically.

let simActive = false;
let simLat = 0;
let simLng = 0;
let simHeading = 0;
let simInterval = null;
let simKeys = {};
let simIndicator = null;

function startSimulator() {
    if (simActive) return;
    simActive = true;
    
    // Use current known position as starting point
    if (globalLocationMarker) {
        simLat = globalLocationMarker.getLatLng().lat;
        simLng = globalLocationMarker.getLatLng().lng;
    } else if (currentOrigin) {
        simLat = currentOrigin.lat;
        simLng = currentOrigin.lng;
    } else {
        simLat = 10.7769;
        simLng = 106.7009;
    }
    
    // Show indicator with Touch UI
    simIndicator = document.createElement('div');
    simIndicator.id = 'sim-indicator';
    simIndicator.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:white;padding:12px;border-radius:12px;z-index:9999;text-align:center;backdrop-filter:blur(8px); display:flex; flex-direction:column; align-items:center; box-shadow: 0 4px 12px rgba(0,0,0,0.3); pointer-events:auto;';
    
    simIndicator.innerHTML = `
        <div style="font-size:12px; font-weight:bold; margin-bottom:10px; color:#10b981;">🎮 SIMULATOR MODE</div>
        <div id="sim-debug" style="font-size:10px; color:yellow; margin-bottom:5px;">Dist: 0m | Seg: 0/0</div>
        <div style="display:flex; gap:10px; margin-bottom:10px;">
            <button id="sim-btn-w" style="width:50px;height:50px;border-radius:25px;border:none;background:#374151;color:white;font-size:24px;">⬆️</button>
        </div>
        <div style="display:flex; gap:10px; margin-bottom:10px;">
            <button id="sim-btn-a" style="width:50px;height:50px;border-radius:25px;border:none;background:#374151;color:white;font-size:24px;">⬅️</button>
            <button id="sim-btn-s" style="width:50px;height:50px;border-radius:25px;border:none;background:#374151;color:white;font-size:24px;">⬇️</button>
            <button id="sim-btn-d" style="width:50px;height:50px;border-radius:25px;border:none;background:#374151;color:white;font-size:24px;">➡️</button>
        </div>
        <button id="sim-btn-close" style="width:100%; padding:10px; border-radius:8px; border:none; background:#ef4444; color:white; font-weight:bold;">Tắt mô phỏng</button>
    `;
    
    document.body.appendChild(simIndicator);
    
    const bindBtn = (id, key) => {
        const btn = document.getElementById(id);
        const start = (e) => { e.preventDefault(); simKeys[key] = true; btn.style.background = '#10b981'; };
        const end = (e) => { e.preventDefault(); simKeys[key] = false; btn.style.background = '#374151'; };
        btn.addEventListener('touchstart', start, {passive:false});
        btn.addEventListener('touchend', end, {passive:false});
        btn.addEventListener('mousedown', start);
        btn.addEventListener('mouseup', end);
        btn.addEventListener('mouseleave', end);
    };
    
    bindBtn('sim-btn-w', 'w');
    bindBtn('sim-btn-a', 'a');
    bindBtn('sim-btn-s', 's');
    bindBtn('sim-btn-d', 'd');
    
    document.getElementById('sim-btn-close').addEventListener('click', stopSimulator);
    
    // Stop real GPS watch to avoid conflict
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    
    // Keyboard listeners
    document.addEventListener('keydown', simKeyDown);
    document.addEventListener('keyup', simKeyUp);
    
    // Tick every 100ms
    const MOVE_SPEED = 0.00005; // ~5.5 meters per tick
    const TURN_SPEED = 5; // degrees per tick
    
    simInterval = setInterval(() => {
        if (simKeys['w'] || simKeys['W']) {
            simLat += MOVE_SPEED * Math.cos(simHeading * Math.PI / 180);
            simLng += MOVE_SPEED * Math.sin(simHeading * Math.PI / 180);
        }
        if (simKeys['s'] || simKeys['S']) {
            simLat -= MOVE_SPEED * Math.cos(simHeading * Math.PI / 180);
            simLng -= MOVE_SPEED * Math.sin(simHeading * Math.PI / 180);
        }
        if (simKeys['a'] || simKeys['A']) {
            simLat += MOVE_SPEED * Math.cos((simHeading - 90) * Math.PI / 180);
            simLng += MOVE_SPEED * Math.sin((simHeading - 90) * Math.PI / 180);
        }
        if (simKeys['d'] || simKeys['D']) {
            simLat += MOVE_SPEED * Math.cos((simHeading + 90) * Math.PI / 180);
            simLng += MOVE_SPEED * Math.sin((simHeading + 90) * Math.PI / 180);
        }
        if (simKeys['ArrowLeft']) {
            simHeading = (simHeading - TURN_SPEED + 360) % 360;
        }
        if (simKeys['ArrowRight']) {
            simHeading = (simHeading + TURN_SPEED) % 360;
        }
        
        // Feed fake GPS data into the REAL handler
        handlePositionUpdate({
            coords: {
                latitude: simLat,
                longitude: simLng,
                heading: simHeading
            }
        });
    }, 100);
    
    console.log('🎮 GPS Simulator started');
}

function stopSimulator() {
    if (!simActive) return;
    simActive = false;
    
    if (simInterval) {
        clearInterval(simInterval);
        simInterval = null;
    }
    
    document.removeEventListener('keydown', simKeyDown);
    document.removeEventListener('keyup', simKeyUp);
    simKeys = {};
    
    if (simIndicator) {
        simIndicator.remove();
        simIndicator = null;
    }
    
    console.log('🎮 GPS Simulator stopped');
}

function simKeyDown(e) {
    simKeys[e.key] = true;
    // Prevent page scroll on arrow keys
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
    }
}

function simKeyUp(e) {
    simKeys[e.key] = false;
}

document.getElementById('btn-sim-mode').addEventListener('click', () => {
    if (simActive) {
        stopSimulator();
    } else {
        startSimulator();
    }
});

// Toggle simulator with 'G' key
document.addEventListener('keydown', (e) => {
    if (e.key === 'g' || e.key === 'G') {
        if (e.repeat) return;
        if (simActive) {
            stopSimulator();
        } else {
            startSimulator();
        }
    }
});
