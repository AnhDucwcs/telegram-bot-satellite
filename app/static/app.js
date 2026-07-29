// Init Telegram Web App
const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

// Map Initialization (OpenLayers)
const map = new ol.Map({
    target: 'map',
    controls: ol.control.defaults.defaults({ zoom: false, attribution: false }),
    layers: [
        new ol.layer.Tile({
            source: new ol.source.XYZ({
                url: 'https://{a-c}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
                maxZoom: 20
            })
        })
    ],
    view: new ol.View({
        center: ol.proj.fromLonLat([106.7009, 10.7769]),
        zoom: 14,
        maxZoom: 20
    })
});

// Variables
let currentOrigin = null;
let currentDestination = null;
let currentRouteGeoJSON = null;

let navStartTime = null;
let totalAwayTimeMs = 0;
let lastPauseTime = null;

// Overlays (Markers)
function createOverlay(color, id, isDot = false) {
    const el = document.createElement('div');
    if (isDot) {
        el.innerHTML = `<div style="width:16px;height:16px;background:#3b82f6;border-radius:50%;border:3px solid white;box-shadow:0 0 10px rgba(0,0,0,0.5);"></div>`;
    } else {
        el.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C7 0 3 4 3 9C3 14.25 12 24 12 24C12 24 21 14.25 21 9C21 4 17 0 12 0ZM12 12C10.3 12 9 10.7 9 9C9 7.3 10.3 6 12 6C13.7 6 15 7.3 15 9C15 10.7 13.7 12 12 12Z"/></svg>`;
    }
    el.id = id;
    const overlay = new ol.Overlay({
        element: el,
        positioning: isDot ? 'center-center' : 'bottom-center',
        offset: isDot ? [0, 0] : [0, 0],
        stopEvent: false
    });
    map.addOverlay(overlay);
    return overlay;
}

const originMarker = createOverlay('#10b981', 'marker-origin');
const destMarker = createOverlay('#ef4444', 'marker-dest');
const globalLocationMarker = createOverlay('#3b82f6', 'marker-user', true);

// Hide them initially
originMarker.setPosition(undefined);
destMarker.setPosition(undefined);
globalLocationMarker.setPosition(undefined);

// Route Layer
const routeSource = new ol.source.Vector();
const routeLayer = new ol.layer.Vector({
    source: routeSource,
    style: new ol.style.Style({
        stroke: new ol.style.Stroke({
            color: '#3b82f6',
            width: 6
        })
    }),
    zIndex: 50
});
map.addLayer(routeLayer);

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
    
    // Try restoring previous session state
    const restored = restoreState();
    
    // Auto-center map on load and start global tracking
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition((pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const coords = ol.proj.fromLonLat([lng, lat]);
            
            if (!globalLocationMarker.getPosition()) {
                globalLocationMarker.setPosition(coords);
                map.getView().animate({center: coords, zoom: 17, duration: 500});
                document.getElementById('btn-my-location-fab').classList.remove('hidden');
            } else {
                globalLocationMarker.setPosition(coords);
            }
        }, () => {}, { enableHighAccuracy: true, maximumAge: 10000 });
    }
    
    document.getElementById('btn-my-location-fab').addEventListener('click', () => {
        if (globalLocationMarker.getPosition()) {
            map.getView().animate({center: globalLocationMarker.getPosition(), zoom: 17, duration: 500});
        } else if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition((pos) => {
                const coords = ol.proj.fromLonLat([pos.coords.longitude, pos.coords.latitude]);
                map.getView().animate({center: coords, zoom: 17, duration: 500});
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
        // Because we use Phosphor icons, we need to toggle the icon class
        const icon = e.target.querySelector('i') || e.target;
        if (panel.classList.contains('collapsed')) {
            icon.className = 'ph-bold ph-caret-down';
        } else {
            icon.className = 'ph-bold ph-caret-up';
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            lastPauseTime = Date.now();
            saveState();
        } else {
            if (lastPauseTime && isNavigating) {
                totalAwayTimeMs += (Date.now() - lastPauseTime);
                lastPauseTime = null;
            }
        }
        
        if (isNavigating) {
            if (document.hidden) {
                releaseWakeLock();
            } else {
                requestWakeLock();
            }
        }
    });
});

// initTheme removed as part of Daytime Minimalist redesign

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
    
    document.addEventListener('click', (e) => {
        const searchPanel = document.querySelector('.search-panel');
        const mapPickerUI = document.getElementById('map-picker-ui');
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
        originMarker.setPosition(undefined);
    } else {
        inputDestination.value = '';
        currentDestination = null;
        destMarker.setPosition(undefined);
    }
    
    document.getElementById('route-info-box').classList.add('hidden');
    routeSource.clear();
    
    checkAndShowButtons();
    suggestionsBox.classList.add('hidden');
    recentRoutesBox.classList.remove('hidden');
}

function resetApp() {
    clearInput('origin');
    clearInput('destination');
    
    currentRouteGeoJSON = null;
    traveledPathCoords = [];
    if (globalPassedFeature) routeSource.removeFeature(globalPassedFeature);
    if (globalRemainingFeature) routeSource.removeFeature(globalRemainingFeature);
    globalPassedFeature = null;
    globalRemainingFeature = null;
    
    if (globalLocationMarker.getPosition()) {
        map.getView().animate({center: globalLocationMarker.getPosition(), zoom: 17, rotation: 0, duration: 500});
    } else {
        map.getView().animate({rotation: 0, duration: 500});
    }
    
    clearSavedState();
}

async function handleInputFocus(type) {
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
    
    const coords = ol.proj.fromLonLat([loc.lng, loc.lat]);
    
    if (type === 'origin') {
        inputOrigin.value = loc.name;
        currentOrigin = loc;
        originMarker.setPosition(coords);
        map.getView().animate({center: coords, zoom: 15, duration: 500});
    } else {
        inputDestination.value = loc.name;
        currentDestination = loc;
        destMarker.setPosition(coords);
        map.getView().animate({center: coords, zoom: 15, duration: 500});
    }
    
    if (currentOrigin && currentDestination) {
        recentRoutesBox.classList.add('hidden');
    } else {
        recentRoutesBox.classList.remove('hidden');
    }
    
    routeSource.clear();
    document.getElementById('route-info-box').classList.add('hidden');
    
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
    if (currentOrigin && currentDestination && !isNavigating) {
        actionButtons.classList.remove('hidden');
        document.getElementById('route-info-box').classList.add('hidden');
    } else {
        actionButtons.classList.add('hidden');
    }
    const actionVisible = !actionButtons.classList.contains('hidden');
    if (actionVisible) {
        document.getElementById('btn-my-location-fab').classList.add('lifted');
    } else {
        document.getElementById('btn-my-location-fab').classList.remove('lifted');
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

// Map Picker
let mapPickerMode = null;
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
    
    const center = map.getView().getCenter();
    const lonlat = ol.proj.toLonLat(center);
    const lng = lonlat[0];
    const lat = lonlat[1];
    
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
    if (globalLocationMarker.getPosition()) {
        const lonlat = ol.proj.toLonLat(globalLocationMarker.getPosition());
        fetchAndSelectLocation(lonlat[1], lonlat[0], type);
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

// Routing Logic
document.getElementById('btn-show-route').addEventListener('click', () => calculateRoute(false));
document.getElementById('btn-navigate').addEventListener('click', () => calculateRoute(true));

async function calculateRoute(startNavigation = false, isReroute = false) {
    if (!currentOrigin || !currentDestination) return;
    
    if (startNavigation && currentRouteGeoJSON && !isReroute) {
        document.querySelector('.search-panel').classList.add('hidden');
        startNavMode();
        return;
    }
    
    if (!isReroute) {
        loadingScreen.classList.remove('hidden');
    }
    
    try {
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
            return pollJobStatus(data.job_id, startNavigation, isReroute);
        } else {
            throw new Error("Failed to start job");
        }
    } catch (e) {
        console.error(e);
        loadingScreen.classList.add('hidden');
        alert("Lỗi khi kết nối đến máy chủ tính đường.");
    }
}

function pollJobStatus(jobId, startNavigation, isReroute) {
    return new Promise((resolve, reject) => {
        const poll = async (retries = 0) => {
            if (retries > 60) return reject(new Error("Timeout")), loadingScreen.classList.add('hidden'), alert("Quá thời gian chờ tính đường.");
            try {
                const res = await fetch(`/api/v1/webapp/job/${jobId}`, { headers: { 'x-telegram-init-data': tg.initData } });
                const data = await res.json();
                
                if (data.status === 'completed') return handleRouteResult(data.result, startNavigation, isReroute), resolve();
                if (data.status === 'error') return loadingScreen.classList.add('hidden'), alert(data.message || "Không tìm thấy đường."), reject(new Error(data.message));
            } catch (e) { console.error("Polling error", e); }
            
            setTimeout(() => poll(retries + 1), 500);
        };
        poll(0);
    });
}

function handleRouteResult(result, startNavigation, isReroute = false) {
    loadingScreen.classList.add('hidden');
    
    currentRouteGeoJSON = result.geojson;
    
    if (!startNavigation) {
        // Just previewing route, clear all and draw single blue line
        routeSource.clear();
        const format = new ol.format.GeoJSON();
        const features = format.readFeatures(currentRouteGeoJSON, {
            dataProjection: 'EPSG:4326',
            featureProjection: 'EPSG:3857'
        });
        routeSource.addFeatures(features);
    } else {
        // During navigation, don't draw raw GeoJSON, let updateRouteDisplay handle it
        if (!isReroute) {
            routeSource.clear();
        }
    }
    
    if (!startNavigation && !isNavigating) {
        // Only fit view when previewing route
        map.getView().fit(routeSource.getExtent(), {padding: [30, 30, 30, 30], duration: 500});
    } else if (isNavigating) {
        // During reroute, re-center on user
        isFollowing = true;
        if (globalLocationMarker.getPosition()) {
            map.getView().animate({center: globalLocationMarker.getPosition(), zoom: 17, duration: 500});
        }
    }
    
    totalRouteTimeMin = result.estimated_time_min || 0;
    totalRouteDistMeters = (result.distance_km || 0) * 1000;
    
    if (!isReroute) {
        initialOriginName = currentOrigin ? (currentOrigin.name || "Vị trí bắt đầu") : "Vị trí bắt đầu";
        initialDestName = currentDestination ? (currentDestination.name || "Vị trí kết thúc") : "Vị trí kết thúc";
        initialRouteTimeMin = totalRouteTimeMin;
        initialRouteDistMeters = totalRouteDistMeters;
    }
    
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
            initRouteSegments(isReroute);
            isRerouting = false; // Reset reroute lock
        }
    } else {
        actionButtons.classList.add('hidden');
        document.getElementById('route-info-box').classList.remove('hidden');
        document.getElementById('btn-my-location-fab').classList.remove('lifted');
    }
    
    // Persist state after route is loaded
    saveState();
}

// Navigation Logic
let watchId = null;
let routeSegments = [];
let currentSegmentIndex = 0;
let isFollowing = true;
let isRerouting = false;
let isNavigating = false;
let lastRerouteTime = 0;
let wakeLock = null;
let totalRouteTimeMin = 0;
let totalRouteDistMeters = 0;
let initialOriginName = null;
let initialDestName = null;
let initialRouteTimeMin = 0;
let initialRouteDistMeters = 0;
let globalPassedFeature = null;
let globalRemainingFeature = null;
let traveledPathCoords = [];
let lastPeriodicRerouteTime = 0;

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock is active!');
        }
    } catch (err) {
        console.warn(`Wake Lock error: ${err.name}, ${err.message}`);
    }
}

function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release().then(() => {
            wakeLock = null;
            console.log('Wake Lock released!');
        });
    }
}

function startNavMode() {
    if (isNavigating) return;
    isNavigating = true;
    
    navStartTime = Date.now();
    totalAwayTimeMs = 0;
    lastPauseTime = null;
    
    if (currentOrigin && currentDestination) {
        fetch('/api/v1/webapp/history/route', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-telegram-init-data': tg.initData
            },
            body: JSON.stringify({
                origin: currentOrigin,
                destination: currentDestination
            })
        }).then(() => loadRecentRoutes()).catch(e => console.error(e));
    }
    
    document.getElementById('screen-search').classList.remove('active');
    document.getElementById('screen-navigation').classList.remove('hidden');
    document.getElementById('screen-navigation').classList.add('active');
    document.querySelector('.search-panel').classList.add('hidden');
    document.getElementById('btn-my-location-fab').classList.add('hidden');
    document.getElementById('action-buttons').classList.add('hidden');
    
    requestWakeLock();
    
    tg.HapticFeedback.notificationOccurred('success');
    
    isFollowing = true;
    
    initRouteSegments();
    
    initRouteSegments();
    
    centerAndRotateMap();
    
    
    if ("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition(handlePositionUpdate, (err) => console.warn(err), {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000
        });
    }
    
    // When user drags, disable following (Track-up rotation)
    map.on('pointerdrag', () => {
        isFollowing = false;
    });
    
    // Persist state
    saveState();
}

function initRouteSegments(isReroute = false) {
    if (!currentRouteGeoJSON) return;
    
    routeSegments = [];
    currentSegmentIndex = 0;
    
    if (!isReroute) {
        traveledPathCoords = [];
        routeSource.clear(); // Wipe the preview GeoJSON from the map
        
        globalPassedFeature = new ol.Feature({ geometry: new ol.geom.LineString([]) });
        globalPassedFeature.setStyle(new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#9ca3af', width: 6 }) }));
        
        globalRemainingFeature = new ol.Feature({ geometry: new ol.geom.LineString([]) });
        globalRemainingFeature.setStyle(new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#3b82f6', width: 6 }) }));
        
        routeSource.addFeatures([globalPassedFeature, globalRemainingFeature]);
        lastPeriodicRerouteTime = Date.now();
    }
    
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
            let edgeTimes = [];
            if (currentRouteGeoJSON.properties && currentRouteGeoJSON.properties.edge_times) {
                edgeTimes = currentRouteGeoJSON.properties.edge_times;
            }
            
            for (let i = 0; i < coords.length - 1; i++) {
                // Keep coords in [lng, lat] for turf
                routeSegments.push({
                    start: [coords[i][0], coords[i][1]],
                    end: [coords[i+1][0], coords[i+1][1]],
                    timeMin: edgeTimes[i] || 0 // Store edge time (minutes) or default to 0
                });
            }
        }
        
        if (routeSegments.length > 0) {
            updateRouteDisplay(0, 0); // Immediately draw the route
        }
    } catch (e) {
        console.error("Lỗi parse GeoJSON:", e);
    }
}

function updateRouteDisplay(closestIndex, fraction) {
    if (routeSegments.length === 0 || !globalPassedFeature || !globalRemainingFeature) return;
    
    const currentSeg = routeSegments[closestIndex];
    const startProj = ol.proj.fromLonLat(currentSeg.start);
    const endProj = ol.proj.fromLonLat(currentSeg.end);
    
    // Interpolate current position on the segment
    const interpProj = [
        startProj[0] + (endProj[0] - startProj[0]) * (1 - fraction),
        startProj[1] + (endProj[1] - startProj[1]) * (1 - fraction)
    ];
    
    if (traveledPathCoords.length >= 2) {
        globalPassedFeature.getGeometry().setCoordinates(traveledPathCoords);
    }
    
    // Build remaining coordinates
    let remainingCoords = [interpProj, endProj];
    for (let i = closestIndex + 1; i < routeSegments.length; i++) {
        remainingCoords.push(ol.proj.fromLonLat(routeSegments[i].end));
    }
    
    globalRemainingFeature.getGeometry().setCoordinates(remainingCoords);
}

function handlePositionUpdate(position) {
    const { latitude, longitude } = position.coords;
    const coords = ol.proj.fromLonLat([longitude, latitude]);
    
    if (globalLocationMarker) {
        globalLocationMarker.setPosition(coords);
    }
    
    if (routeSegments.length === 0 || isRerouting) return;
    
    // Always push current coordinate to traveledPathCoords for Independent Path Tracking
    if (traveledPathCoords.length === 0) {
        traveledPathCoords.push(coords);
    } else {
        const lastCoords = traveledPathCoords[traveledPathCoords.length - 1];
        if (lastCoords[0] !== coords[0] || lastCoords[1] !== coords[1]) {
            traveledPathCoords.push(coords);
        }
    }
    
    let minDistance = Infinity;
    let closestIndex = currentSegmentIndex;
    
    const maxCheck = Math.min(routeSegments.length, currentSegmentIndex + 10);
    for (let i = currentSegmentIndex; i < maxCheck; i++) {
        const seg = routeSegments[i];
        // turf pointToLineDistance returns distance in kilometers
        const distKm = turf.pointToLineDistance(
            turf.point([longitude, latitude]),
            turf.lineString([seg.start, seg.end]),
            {units: 'meters'}
        );
        if (distKm < minDistance) {
            minDistance = distKm;
            closestIndex = i;
        }
    }
    
    if (closestIndex > currentSegmentIndex) {
        currentSegmentIndex = closestIndex;
    }
    
    // Destination Reached Logic
    const isAtEndSegments = currentSegmentIndex >= routeSegments.length - 2;
    const finalDest = routeSegments[routeSegments.length - 1].end;
    const distToDest = turf.distance(
        turf.point([longitude, latitude]),
        turf.point(finalDest),
        {units: 'meters'}
    );
    
    if (isAtEndSegments && distToDest < 50) {
        // Reached destination!
        showToast("Chúc mừng! Bạn đã đến đích.", true);
        tg.HapticFeedback.notificationOccurred('success');
        
        // Gửi thống kê chuyến đi qua Telegram (Background)
        const originName = initialOriginName || "Vị trí bắt đầu";
        const destName = initialDestName || "Vị trí kết thúc";
        const distKm = (initialRouteDistMeters / 1000).toFixed(1);
        const estimatedTimeMin = Math.ceil(initialRouteTimeMin);
        
        let totalTimeMin = 0;
        let awayTimeMin = 0;
        let displayTimeMin = 0;
        
        if (navStartTime) {
            const totalMs = Date.now() - navStartTime;
            totalTimeMin = Math.max(1, Math.round(totalMs / 60000));
            awayTimeMin = Math.round(totalAwayTimeMs / 60000);
            displayTimeMin = Math.max(0, totalTimeMin - awayTimeMin);
        }
        
        fetch('/api/v1/webapp/trip-completed', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-telegram-init-data': tg.initData
            },
            body: JSON.stringify({
                origin_name: originName,
                destination_name: destName,
                distance_km: distKm,
                estimated_time_min: estimatedTimeMin,
                total_time_min: totalTimeMin,
                away_time_min: awayTimeMin,
                display_time_min: displayTimeMin
            })
        }).catch(err => console.error("Error sending trip stats:", err));

        stopNavMode();
        return;
    }
    
    const debugEl = document.getElementById('sim-debug');
    if (debugEl) {
        debugEl.textContent = `Dist: ${Math.round(minDistance)}m | Seg: ${currentSegmentIndex}/${routeSegments.length}`;
    }
    
    // Rotation (Track-up mode) using upcoming nodes to determine direction
    if (isFollowing) {
        // Calculate bearing using turf
        const p1 = routeSegments[closestIndex].start;
        // Use the end of the next segment for smoother rotation around corners if available
        let lookAheadIndex = closestIndex;
        if (closestIndex + 1 < routeSegments.length) {
            lookAheadIndex = closestIndex + 1;
        }
        const p2 = routeSegments[lookAheadIndex].end;
        
        const bearing = turf.bearing(turf.point(p1), turf.point(p2)); // -180 to 180
        
        // OpenLayers rotation: radians clockwise. Pointing bearing UP means rotating view by -bearing
        const bearingRad = bearing * (Math.PI / 180);
        
        map.getView().animate({
            center: coords,
            rotation: -bearingRad,
            duration: 250
        });
    }
    
    // Dynamic ETA & Distance calculation
    if (routeSegments.length > 0 && totalRouteDistMeters > 0) {
        let remainingDistMeters = 0;
        
        // Add distance for all upcoming full segments
        for (let i = closestIndex + 1; i < routeSegments.length; i++) {
            remainingDistMeters += turf.distance(turf.point(routeSegments[i].start), turf.point(routeSegments[i].end), {units: 'meters'});
        }
        
        // For the current segment, calculate remaining fraction
        const currentSeg = routeSegments[closestIndex];
        const segLenMeters = turf.distance(turf.point(currentSeg.start), turf.point(currentSeg.end), {units: 'meters'});
        // Approximate distance passed along this segment
        const distToEndMeters = turf.distance(turf.point([longitude, latitude]), turf.point(currentSeg.end), {units: 'meters'});
        
        let fraction = 1;
        if (segLenMeters > 0) {
            fraction = distToEndMeters / segLenMeters;
            fraction = Math.min(Math.max(fraction, 0), 1); // Clamp between 0 and 1
            remainingDistMeters += segLenMeters * fraction;
        }
        
        // Linear Interpolation for ETA
        let remainingTimeMin = (remainingDistMeters / totalRouteDistMeters) * totalRouteTimeMin;
        
        // Update UI
        const etaText = `${Math.ceil(remainingTimeMin)} phút`;
        document.getElementById('nav-eta').textContent = etaText;
        
        const distKm = remainingDistMeters / 1000;
        const distText = distKm >= 1 ? `${distKm.toFixed(1)} km` : `${Math.round(remainingDistMeters)} m`;
        document.getElementById('nav-total-dist').textContent = distText;
        
        // Update Route Color Display (gray out passed segments)
        updateRouteDisplay(closestIndex, fraction);
    }
    
    const now = Date.now();
    
    // Periodic Rerouting (Every 10 minutes)
    if (now - lastPeriodicRerouteTime > 600000 && minDistance <= 50) {
        lastPeriodicRerouteTime = now;
        currentOrigin = {
            name: "Vị trí hiện tại",
            lat: latitude,
            lng: longitude
        };
        // Background reroute, no loading screen, preserve traveled path
        calculateRoute(true, true);
    }
    
    // Deviation Rerouting
    if (minDistance > 50 && (now - lastRerouteTime > 15000)) {
        isRerouting = true;
        lastRerouteTime = now;
        showToast("Lệch tuyến! Đang tính lại...");
        tg.HapticFeedback.notificationOccurred('warning');
        
        currentOrigin = {
            name: "Vị trí hiện tại",
            lat: latitude,
            lng: longitude
        };
        
        currentRouteGeoJSON = null;
        
        calculateRoute(true, true).then(() => {
            isRerouting = false;
        }).catch(() => {
            isRerouting = false;
        });
    }
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
    
    stopSimulator();
    
    // Clear persisted state since user explicitly stopped navigation
    clearSavedState();
    
    document.getElementById('screen-navigation').classList.remove('active');
    document.getElementById('screen-navigation').classList.add('hidden');
    document.getElementById('screen-search').classList.add('active');
    document.querySelector('.search-panel').classList.remove('hidden');
    document.getElementById('btn-my-location-fab').classList.remove('hidden');
    
    releaseWakeLock();
    
    resetApp();
}

document.getElementById('btn-stop-nav').addEventListener('click', stopNavMode);

// FAB Menu Logic
const fabMenuBtn = document.getElementById('btn-nav-menu');
const navPopupMenu = document.getElementById('nav-popup-menu');
fabMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navPopupMenu.classList.toggle('hidden');
});
document.addEventListener('click', () => {
    if (!navPopupMenu.classList.contains('hidden')) {
        navPopupMenu.classList.add('hidden');
    }
});
function centerAndRotateMap() {
    isFollowing = true;
    if (globalLocationMarker.getPosition()) {
        let bearingRad = 0;
        if (routeSegments.length > 0 && currentSegmentIndex < routeSegments.length) {
            const p1 = routeSegments[currentSegmentIndex].start;
            let lookAheadIndex = currentSegmentIndex;
            if (currentSegmentIndex + 1 < routeSegments.length) {
                lookAheadIndex = currentSegmentIndex + 1;
            }
            const p2 = routeSegments[lookAheadIndex].end;
            const bearing = turf.bearing(turf.point(p1), turf.point(p2));
            bearingRad = bearing * (Math.PI / 180);
        }
        
        map.getView().animate({
            center: globalLocationMarker.getPosition(),
            zoom: 17,
            rotation: -bearingRad,
            duration: 500
        });
    }
}

document.getElementById('btn-recenter').addEventListener('click', centerAndRotateMap);

// Simulator
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
    
    if (globalLocationMarker.getPosition()) {
        const lonlat = ol.proj.toLonLat(globalLocationMarker.getPosition());
        simLat = lonlat[1];
        simLng = lonlat[0];
    } else if (currentOrigin) {
        simLat = currentOrigin.lat;
        simLng = currentOrigin.lng;
    } else {
        simLat = 10.7769;
        simLng = 106.7009;
    }
    
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
    
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    
    document.addEventListener('keydown', simKeyDown);
    document.addEventListener('keyup', simKeyUp);
    
    const MOVE_SPEED = 0.00005;
    const TURN_SPEED = 5;
    
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
        
        handlePositionUpdate({
            coords: {
                latitude: simLat,
                longitude: simLng,
                heading: simHeading
            }
        });
    }, 100);
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
}

function simKeyDown(e) {
    simKeys[e.key] = true;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
    }
}

function simKeyUp(e) {
    simKeys[e.key] = false;
}

document.getElementById('btn-sim-mode').addEventListener('click', () => {
    if (simActive) stopSimulator();
    else startSimulator();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'g' || e.key === 'G') {
        if (e.repeat) return;
        if (simActive) stopSimulator();
        else startSimulator();
    }
});

// ==========================================
// Google Maps Rescue Button
// ==========================================

document.getElementById('btn-rescue-gmaps').addEventListener('click', () => {
    if (!currentDestination) {
        showToast('Chưa có điểm đến để cứu hộ!');
        return;
    }
    
    const destLat = currentDestination.lat;
    const destLng = currentDestination.lng;
    
    // Save state before leaving (OS may kill the Mini App)
    saveState();
    
    showToast('Đang mở Google Maps...');
    tg.HapticFeedback.notificationOccurred('warning');
    
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const travelMode = isMobile ? 'two-wheeler' : 'driving';
    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}&travelmode=${travelMode}&dir_action=navigate`;
    
    // Use Telegram WebApp API to open external link (forces native browser/app)
    try {
        tg.openLink(gmapsUrl);
    } catch (e) {
        // Fallback if Telegram API not available
        window.open(gmapsUrl, '_blank');
    }
});

// ==========================================
// State Persistence (localStorage)
// ==========================================

const STATE_KEY = 'sgn_route_state';

function saveState() {
    if (!currentOrigin || !currentDestination || !currentRouteGeoJSON) return;
    try {
        const state = {
            currentOrigin,
            currentDestination,
            currentRouteGeoJSON,
            isNavigating,
            etaText: document.getElementById('nav-eta').textContent,
            distText: document.getElementById('nav-total-dist').textContent,
            totalRouteTimeMin,
            totalRouteDistMeters,
            initialOriginName,
            initialDestName,
            initialRouteTimeMin,
            initialRouteDistMeters,
            navStartTime,
            totalAwayTimeMs,
            timestamp: Date.now()
        };
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn('Failed to save state:', e);
    }
}

function clearSavedState() {
    try {
        localStorage.removeItem(STATE_KEY);
    } catch (e) {
        console.warn('Failed to clear state:', e);
    }
}

function restoreState() {
    try {
        const raw = localStorage.getItem(STATE_KEY);
        if (!raw) return false;
        
        const state = JSON.parse(raw);
        
        // Ignore state older than 30 minutes (TTL)
        if (Date.now() - state.timestamp > 30 * 60 * 1000) {
            clearSavedState();
            return false;
        }
        
        // Restore time tracking
        if (state.navStartTime) {
            navStartTime = state.navStartTime;
            totalAwayTimeMs = state.totalAwayTimeMs || 0;
            const away = Date.now() - state.timestamp;
            totalAwayTimeMs += away;
        }
        
        // Restore origin & destination
        if (state.currentOrigin) {
            currentOrigin = state.currentOrigin;
            inputOrigin.value = currentOrigin.name || 'Vị trí bắt đầu';
            originMarker.setPosition(ol.proj.fromLonLat([currentOrigin.lng, currentOrigin.lat]));
        }
        if (state.currentDestination) {
            currentDestination = state.currentDestination;
            inputDestination.value = currentDestination.name || 'Vị trí kết thúc';
            destMarker.setPosition(ol.proj.fromLonLat([currentDestination.lng, currentDestination.lat]));
        }
        
        // Restore route and navigation mode
        if (state.currentRouteGeoJSON) {
            currentRouteGeoJSON = state.currentRouteGeoJSON;
            
            // Draw the route on the map
            routeSource.clear();
            const format = new ol.format.GeoJSON();
            const features = format.readFeatures(currentRouteGeoJSON, {
                dataProjection: 'EPSG:4326',
                featureProjection: 'EPSG:3857'
            });
            routeSource.addFeatures(features);
        }
        
        if (state.isNavigating && state.currentRouteGeoJSON) {
            // Restore UI to Route Info mode (ready to resume)
            // DO NOT automatically call watchPosition to avoid permission prompts without user gesture
            actionButtons.classList.add('hidden');
            recentRoutesBox.classList.add('hidden');
            document.getElementById('route-info-box').classList.remove('hidden');
            
            if (state.etaText) {
                document.getElementById('info-eta').textContent = state.etaText;
                document.getElementById('nav-eta').textContent = state.etaText;
            }
            if (state.distText) {
                document.getElementById('info-dist').textContent = state.distText;
                document.getElementById('nav-total-dist').textContent = state.distText;
            }
            
            if (state.totalRouteTimeMin !== undefined) totalRouteTimeMin = state.totalRouteTimeMin;
            if (state.totalRouteDistMeters !== undefined) totalRouteDistMeters = state.totalRouteDistMeters;
            
            if (state.initialOriginName !== undefined) initialOriginName = state.initialOriginName;
            if (state.initialDestName !== undefined) initialDestName = state.initialDestName;
            if (state.initialRouteTimeMin !== undefined) initialRouteTimeMin = state.initialRouteTimeMin;
            if (state.initialRouteDistMeters !== undefined) initialRouteDistMeters = state.initialRouteDistMeters;
            
            // Set initial zoom and center to the start of the route
            if (currentRouteGeoJSON && currentRouteGeoJSON.features) {
                let coords = currentRouteGeoJSON.features[0].geometry.coordinates;
                if (coords.length > 0) {
                    const startProj = ol.proj.fromLonLat(coords[0]);
                    map.getView().animate({ center: startProj, zoom: 17, duration: 500 });
                }
            }

            
            showToast('Nhấn Dẫn đường để tiếp tục phiên của bạn');
            return true;
        }
        
        return false;
    } catch (e) {
        console.warn('Failed to restore state:', e);
        clearSavedState();
        return false;
    }
}
