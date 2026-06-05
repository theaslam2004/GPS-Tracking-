// Share Link Live Tracking Script
let map;
let marker;
let targetImei = null;
let currentLayerName = 'standard';
let driverName = 'Unassigned';
let vehicleProfile = 'standard';
let latestTelemetry = null;

const liveTrails = {}; // Store recent trail coordinates
const liveTrailPolylines = {}; // Store trail polyline layers
const mapLayers = {
    standard: L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '&copy; Google Maps'
    }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' })
};

const addressCache = {};

function getAddress(imei, lat, lng, callback) {
    const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (addressCache[imei] && addressCache[imei].coords === cacheKey) {
        if (callback) callback(addressCache[imei].address);
        return;
    }
    
    // Fetch from geocode API
    fetch(`/api/geocode?lat=${lat}&lon=${lng}`)
        .then(res => res.json())
        .then(geo => {
            let addr = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            if (geo && geo.display_name) {
                addr = geo.display_name.split(',').slice(0, 3).join(', ').trim();
            }
            addressCache[imei] = { coords: cacheKey, address: addr };
            if (callback) callback(addr);
            
            // Proactively update any existing popup element in the DOM
            const popupAddrEl = document.getElementById(`popup-address-${imei}`);
            if (popupAddrEl) popupAddrEl.innerText = addr;
        })
        .catch(() => {
            const addr = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            addressCache[imei] = { coords: cacheKey, address: addr };
            if (callback) callback(addr);
        });
}

function timeSince(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function buildTelemetryHTML(telemetry, name) {
    const { latitude, longitude, speed, heading, odometer, timestamp } = telemetry;
    const timeObj = new Date(timestamp);
    const isStale = (Date.now() - new Date(timestamp)) > 60000;
    
    let status = 'offline';
    let statusText = 'Offline';
    if (!isStale) {
        status = telemetry.status || 'halt';
        statusText = status.charAt(0).toUpperCase() + status.slice(1);
        if (status === 'halt') statusText = 'Halted';
    }

    const profileText = vehicleProfile === 'heavy' ? 'Heavy (48V)' : 'Standard (12V/24V)';

    // Simulated Fuel & Adblue based on profile (matches Taabi style)
    const showMockFuel = vehicleProfile === 'heavy'; 
    const fuelText = showMockFuel ? '210 L / 360 L' : 'N/A';
    const fuelPercent = showMockFuel ? 58 : 0;
    const adblueText = showMockFuel ? '15 L / 25 L' : 'N/A';
    const adbluePercent = showMockFuel ? 60 : 0;

    const odoVal = (odometer !== undefined && odometer >= 0) ? `${odometer.toFixed(1)} km` : '--';
    const coordsString = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

    return `
    <div class="taabi-popup" style="padding: 1rem; width: 290px; font-family: 'Outfit', sans-serif;">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-light); padding-bottom: 8px; margin-bottom: 8px;">
            <div style="font-weight: 800; font-size: 1.05rem; letter-spacing: 0.5px; color: var(--text-primary); text-transform: uppercase;">
                ${name || targetImei}
            </div>
            <span class="taabi-status-capsule ${status}">
                ${statusText}
            </span>
        </div>

        <!-- Vehicle Details Info rows -->
        <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.76rem; color: var(--text-secondary);">
            <!-- Vehicle Profile / Model -->
            <div style="display: flex; align-items: center; gap: 8px;">
                <i class="fa-solid fa-truck" style="color: var(--primary); font-size: 0.85rem; width: 14px;"></i>
                <span>Profile: <b>${profileText}</b> | Driver: <b>${driverName}</b></span>
            </div>
            
            <!-- Address Row -->
            <div style="display: flex; align-items: flex-start; gap: 8px; line-height: 1.3;">
                <i class="fa-solid fa-location-dot" style="color: var(--primary); font-size: 0.85rem; width: 14px; margin-top: 2px;"></i>
                <span id="popup-address-${targetImei}" class="popup-address-text" style="color: var(--text-primary); font-weight: 600;">${coordsString}</span>
            </div>

            <!-- Speed & Odo Row -->
            <div style="display: flex; gap: 12px; margin-top: 2px; border-top: 1px solid var(--border-light); border-bottom: 1px solid var(--border-light); padding: 6px 0;">
                <div style="flex: 1; display: flex; align-items: center; gap: 6px;">
                    <i class="fa-solid fa-gauge-high" style="color: var(--success); font-size: 0.85rem;"></i>
                    <span>Speed: <b style="color: var(--text-primary);">${speed} km/h</b></span>
                </div>
                <div style="flex: 1; display: flex; align-items: center; gap: 6px;">
                    <i class="fa-solid fa-road" style="color: var(--primary); font-size: 0.85rem;"></i>
                    <span>Odo: <b style="color: var(--text-primary);">${odoVal}</b></span>
                </div>
            </div>

            <!-- Fuel Bar -->
            <div style="display: flex; flex-direction: column; gap: 2px; margin-top: 2px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.7rem;">
                    <span><i class="fa-solid fa-gas-pump" style="color: var(--primary);"></i> Fuel</span>
                    <span style="font-weight: 700; color: var(--text-primary);">${fuelText}</span>
                </div>
                ${showMockFuel ? `
                <div class="taabi-progress-container">
                    <div class="taabi-progress-fill fuel" style="width: ${fuelPercent}%;"></div>
                </div>` : ''}
            </div>

            <!-- Adblue Bar -->
            <div style="display: flex; flex-direction: column; gap: 2px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.7rem;">
                    <span><i class="fa-solid fa-flask" style="color: #00d4ff;"></i> Adblue</span>
                    <span style="font-weight: 700; color: var(--text-primary);">${adblueText}</span>
                </div>
                ${showMockFuel ? `
                <div class="taabi-progress-container">
                    <div class="taabi-progress-fill adblue" style="width: ${adbluePercent}%;"></div>
                </div>` : ''}
            </div>

            <!-- Footer: Last updated -->
            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-light); padding-top: 6px; margin-top: 4px; font-size: 0.68rem;">
                <span>Last Updated: <b style="color: var(--text-primary);">${timeSince(timeObj)}</b></span>
            </div>
        </div>
    </div>
    `;
}

// Parse parameter 'id' from query string
const urlParams = new URLSearchParams(window.location.search);
const shareId = urlParams.get('id');

if (!shareId) {
    showError();
} else {
    initTracking();
}

function showError() {
    document.getElementById('errorOverlay').style.display = 'grid';
}

async function initTracking() {
    try {
        const res = await fetch(`/api/share-link/${shareId}`);
        const data = await res.json();
        
        if (!data.success) {
            showError();
            return;
        }
        
        targetImei = data.imei;
        driverName = data.driverName || 'Unassigned';
        vehicleProfile = data.vehicleProfile || 'standard';
        document.getElementById('vehicleName').innerText = data.name || data.imei;
        
        // Initialize Map
        map = L.map('map').setView([20.5937, 78.9629], 5);
        mapLayers.standard.addTo(map); // Default to daylight layer
        currentLayerName = 'standard';
        
        // Dynamic address resolver and HTML refresher on popup open
        map.on('popupopen', function(e) {
            const popup = e.popup;
            const container = popup.getElement();
            if (container) {
                const addrEl = container.querySelector('[id^="popup-address-"]');
                if (addrEl) {
                    const imei = addrEl.id.replace('popup-address-', '');
                    const live = latestTelemetry;
                    if (live) {
                        // Refresh popup content dynamically to sync elapsed time and offline status
                        const name = document.getElementById('vehicleName').innerText;
                        popup.setContent(buildTelemetryHTML(live, name));
                        
                        // Re-resolve address and insert it in the fresh content
                        getAddress(imei, live.latitude, live.longitude, (addr) => {
                            const newAddrEl = popup.getElement().querySelector('[id^="popup-address-"]');
                            if (newAddrEl) newAddrEl.innerText = addr;
                        });
                    }
                }
            }
        });

        // Show info panel
        document.getElementById('infoPanel').style.display = 'block';
        document.getElementById('panelTitle').innerText = data.name || data.imei;
        
        if (data.lastSeen) {
            updateVehicleOnMap(data.lastSeen, data.name || data.imei);
        } else {
            document.getElementById('valStatus').innerText = 'Offline';
            document.getElementById('valStatus').style.color = 'var(--danger)';
        }
        
        // Initialize Socket.io Connection
        const socket = io();
        socket.on('device_data', (deviceData) => {
            if (deviceData.imei === targetImei) {
                console.log('[Socket] Received shared coordinates update:', deviceData);
                updateVehicleOnMap(deviceData, data.name || data.imei);
            }
        });
        
    } catch(e) {
        console.error('Failed to initialize tracking', e);
        showError();
    }
}

function updateVehicleOnMap(telemetry, name) {
    const { latitude, longitude, speed, heading, odometer, timestamp } = telemetry;
    latestTelemetry = telemetry;
    
    const latlng = [latitude, longitude];
    
    // Update marker
    const isStale = (Date.now() - new Date(timestamp)) > 60000;
    const status = isStale ? 'offline' : (telemetry.status || 'halt');
    const markerIcon = getVehicleIcon(heading, status);
    const popupHTML = buildTelemetryHTML(telemetry, name);
    
    if (marker) {
        marker.setLatLng(latlng);
        marker.setIcon(markerIcon);
        if (marker.isPopupOpen()) {
            marker.getPopup().setContent(popupHTML);
        } else {
            marker.setPopupContent(popupHTML);
        }
    } else {
        marker = L.marker(latlng, { icon: markerIcon }).addTo(map)
            .bindPopup(popupHTML)
            .openPopup();
        map.setView(latlng, 15);
    }
    
    // Smooth transition
    map.panTo(latlng);
    
    // Draw 1-minute breadcrumb trail (dashed line)
    if (latitude && longitude && latitude !== 0 && longitude !== 0 && targetImei) {
        const imei = targetImei;
        if (!liveTrails[imei]) {
            liveTrails[imei] = [];
        }
        const lastPt = liveTrails[imei][liveTrails[imei].length - 1];
        const timestampMs = new Date(timestamp).getTime();
        if (!lastPt || lastPt.lat !== latitude || lastPt.lng !== longitude) {
            liveTrails[imei].push({ lat: latitude, lng: longitude, timestamp: timestampMs });
        } else if (lastPt) {
            lastPt.timestamp = timestampMs;
        }
        
        const oneMinuteAgo = Date.now() - 60000;
        liveTrails[imei] = liveTrails[imei].filter(pt => pt.timestamp >= oneMinuteAgo);
        
        const latlngs = liveTrails[imei].map(pt => [pt.lat, pt.lng]);
        if (latlngs.length >= 2) {
            if (liveTrailPolylines[imei]) {
                liveTrailPolylines[imei].setLatLngs(latlngs);
            } else {
                liveTrailPolylines[imei] = L.polyline(latlngs, {
                    color: '#ff3b70',
                    weight: 3,
                    dashArray: '6, 6',
                    opacity: 0.8
                }).addTo(map);
            }
        } else if (liveTrailPolylines[imei]) {
            map.removeLayer(liveTrailPolylines[imei]);
            delete liveTrailPolylines[imei];
        }
    }
    
    // Update Info Panel
    let displayStatus = 'Offline';
    let displayColor = '#94a3b8';
    if (!isStale) {
        if (status === 'running') {
            displayStatus = 'Running';
            displayColor = '#00E676';
        } else if (status === 'idle') {
            displayStatus = 'Idle';
            displayColor = '#FFab00';
        } else {
            displayStatus = 'Halted';
            displayColor = '#FF3D00';
        }
    }
    
    document.getElementById('valStatus').innerText = displayStatus;
    document.getElementById('valStatus').style.color = displayColor;
    document.getElementById('valSpeed').innerText = `${speed} km/h`;
    document.getElementById('valOdometer').innerText = odometer && odometer > 0 ? `${odometer.toFixed(1)} km` : '--';
    document.getElementById('valTime').innerText = new Date(timestamp).toLocaleTimeString();
}

// Custom vehicle divIcon rotation helper
function getVehicleIcon(heading, status) {
    let color = '#FF3D00'; // Halt (Red)
    let pulseClass = '';
    if (status === 'running') {
        color = '#00E676'; // Moving (Green)
        pulseClass = 'beacon-pulse';
    } else if (status === 'idle') {
        color = '#FFab00'; // Idle (Amber)
    } else if (status === 'offline') {
        color = '#94a3b8'; // Offline (Gray)
    }
    
    return L.divIcon({
        className: 'custom-vehicle-marker',
        html: `
            <div class="vehicle-beacon ${pulseClass}" style="background: ${color}; color: ${color}; border: 1.5px solid rgba(255, 255, 255, 0.4); box-shadow: 0 0 8px ${color};">
                <div class="heading-arrow" style="transform: rotate(${heading || 0}deg); color: #ffffff;">
                    <i class="fa-solid fa-location-arrow"></i>
                </div>
            </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -18]
    });
}

// Periodic cleanup of trail points older than 1 minute
setInterval(() => {
    const oneMinuteAgo = Date.now() - 60000;
    if (targetImei && liveTrails[targetImei]) {
        const imei = targetImei;
        liveTrails[imei] = liveTrails[imei].filter(pt => pt.timestamp >= oneMinuteAgo);
        const latlngs = liveTrails[imei].map(pt => [pt.lat, pt.lng]);
        if (liveTrailPolylines[imei]) {
            if (latlngs.length < 2) {
                map.removeLayer(liveTrailPolylines[imei]);
                delete liveTrailPolylines[imei];
            } else {
                liveTrailPolylines[imei].setLatLngs(latlngs);
            }
        }
    }
}, 5000);

// Periodically refresh the info panel and open popup to sync elapsed time and offline status
setInterval(() => {
    if (latestTelemetry) {
        updateVehicleOnMap(latestTelemetry, document.getElementById('vehicleName').innerText);
    }
}, 10000);
