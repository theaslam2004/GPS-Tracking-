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
    const markerIcon = getVehicleIcon(heading, status, telemetry.voltage);

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

// // Custom vehicle divIcon rotation helper using premium top-down vehicle SVGs based on name, profile, and voltage
function getVehicleIcon(heading, status, voltage) {
    const profile = vehicleProfile || 'standard';
    const name = (document.getElementById('vehicleName') ? document.getElementById('vehicleName').innerText : '').toLowerCase();
    const imei = targetImei || 'share';
    
    let iconType = 'ace'; // Default fallback is Tata Ace instead of generic car
    
    // 1. Classification by Name / Profile
    if (name.includes('heavy') || profile === 'heavy' || name.includes('truck') || name.includes('excavator') || name.includes('tractor') || name.includes('dumper')) {
        iconType = 'heavy';
    } else if (name.includes('eicher') || name.includes('tempo') || name.includes('van') || name.includes('bus')) {
        iconType = 'eicher';
    } else if (name.includes('ace') || name.includes('chota') || name.includes('mini')) {
        iconType = 'ace';
    } else if (name.includes('rickshaw') || name.includes('auto') || name.includes('tuk')) {
        iconType = 'rickshaw';
    }
    // 2. Classification fallback by Battery Voltage (12V: Ace, 24V: Eicher, 48V: Heavy) if no specific match
    else if (voltage !== undefined && voltage !== null) {
        const v = parseFloat(voltage);
        if (v > 36) {
            iconType = 'heavy';
        } else if (v > 18) {
            iconType = 'eicher';
        } else {
            iconType = 'ace';
        }
    }
    
    let color = '#FF3D00'; // Halt (Red)
    if (status === 'running') {
        color = '#00E676'; // Moving (Green)
    } else if (status === 'idle') {
        color = '#FFab00'; // Idle (Amber)
    } else if (status === 'offline') {
        color = '#94a3b8'; // Offline (Gray)
    }
    
    let svgHtml = '';
    let size = [30, 60];
    let anchor = [15, 30];
    
    if (iconType === 'heavy') {
        size = [32, 74];
        anchor = [16, 37];
        svgHtml = `
        <svg viewBox="0 0 100 240" width="32" height="74" style="display:block;">
          <rect x="2" y="50" width="14" height="30" rx="5" fill="#111" />
          <rect x="84" y="50" width="14" height="30" rx="5" fill="#111" />
          <rect x="2" y="155" width="14" height="35" rx="5" fill="#111" />
          <rect x="84" y="155" width="14" height="35" rx="5" fill="#111" />
          <rect x="2" y="195" width="14" height="35" rx="5" fill="#111" />
          <rect x="84" y="195" width="14" height="35" rx="5" fill="#111" />
          <rect x="30" y="70" width="40" height="150" fill="#0f172a" />
          <rect x="15" y="15" width="70" height="65" rx="8" fill="url(#heavyCab-${imei})" stroke="#854d0e" stroke-width="3" />
          <path d="M 22 25 L 26 42 H 74 L 78 25 Z" fill="#94a3b8" opacity="0.8" />
          <rect x="10" y="35" width="5" height="25" fill="#ca8a04" />
          <rect x="85" y="35" width="5" height="25" fill="#ca8a04" />
          <circle cx="35" cy="55" r="5" fill="#1e293b" />
          <circle cx="35" cy="55" r="2" fill="#000" />
          <rect x="10" y="85" width="80" height="142" rx="4" fill="url(#heavyBucket-${imei})" stroke="#0f172a" stroke-width="3" />
          <line x1="20" y1="110" x2="80" y2="110" stroke="#0f172a" stroke-width="3" />
          <line x1="20" y1="135" x2="80" y2="135" stroke="#0f172a" stroke-width="3" />
          <line x1="20" y1="160" x2="80" y2="160" stroke="#0f172a" stroke-width="3" />
          <line x1="20" y1="185" x2="80" y2="185" stroke="#0f172a" stroke-width="3" />
          <line x1="20" y1="210" x2="80" y2="210" stroke="#0f172a" stroke-width="3" />
          <polygon points="18,15 28,15 25,22 18,22" fill="#fef08a" />
          <polygon points="82,15 72,15 75,22 82,22" fill="#fef08a" />
          <defs>
            <linearGradient id="heavyCab-${imei}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#eab308"/>
              <stop offset="100%" stop-color="#ca8a04"/>
            </linearGradient>
            <linearGradient id="heavyBucket-${imei}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#475569"/>
              <stop offset="100%" stop-color="#1e293b"/>
            </linearGradient>
          </defs>
        </svg>`;
    } else if (iconType === 'eicher') {
        size = [30, 72];
        anchor = [15, 36];
        svgHtml = `
        <svg viewBox="0 0 100 240" width="30" height="72" style="display:block;">
          <rect x="6" y="55" width="10" height="25" rx="3" fill="#000" />
          <rect x="84" y="55" width="10" height="25" rx="3" fill="#000" />
          <rect x="4" y="160" width="12" height="25" rx="3" fill="#000" />
          <rect x="84" y="160" width="12" height="25" rx="3" fill="#000" />
          <rect x="4" y="195" width="12" height="25" rx="3" fill="#000" />
          <rect x="84" y="195" width="12" height="25" rx="3" fill="#000" />
          <rect x="35" y="75" width="30" height="150" fill="#1e293b" />
          <rect x="12" y="12" width="76" height="72" rx="10" fill="url(#eicherCab-${imei})" stroke="#14532d" stroke-width="2" />
          <path d="M 18 25 L 22 42 H 78 L 82 25 Z" fill="#94a3b8" opacity="0.8" stroke="#0f291e" />
          <rect x="35" y="50" width="30" height="20" rx="3" fill="#15803d" stroke="#14532d" />
          <rect x="1" y="38" width="11" height="18" rx="2" fill="#1e293b" />
          <rect x="88" y="38" width="11" height="18" rx="2" fill="#1e293b" />
          <rect x="10" y="90" width="80" height="138" rx="3" fill="url(#eicherBed-${imei})" stroke="#451a03" stroke-width="2" />
          <rect x="14" y="94" width="72" height="130" fill="#451a03" opacity="0.4" />
          <circle cx="24" cy="18" r="5" fill="#fffae0" />
          <circle cx="76" cy="18" r="5" fill="#fffae0" />
          <defs>
            <linearGradient id="eicherCab-${imei}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#15803d"/>
              <stop offset="100%" stop-color="#166534"/>
            </linearGradient>
            <linearGradient id="eicherBed-${imei}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#b45309"/>
              <stop offset="100%" stop-color="#78350f"/>
            </linearGradient>
          </defs>
        </svg>`;
    } else if (iconType === 'rickshaw') {
        size = [26, 48];
        anchor = [13, 24];
        svgHtml = `
        <svg viewBox="0 0 100 180" width="26" height="48" style="display:block;">
          <rect x="46" y="10" width="8" height="20" rx="2" fill="#000" />
          <rect x="8" y="125" width="10" height="22" rx="2" fill="#000" />
          <rect x="82" y="125" width="10" height="22" rx="2" fill="#000" />
          <path d="M 45 30 L 15 110 V 150 H 85 V 110 L 55 30 Z" fill="#1e293b" />
          <path d="M 46 38 C 46 38, 18 100, 18 115 C 18 140, 82 140, 82 115 C 82 100, 54 38, 54 38 Z" fill="url(#rickshawYellow-${imei})" stroke="#854d0e" stroke-width="2" />
          <path d="M 45 42 L 35 65 H 65 L 55 42 Z" fill="#000" />
          <rect x="24" y="58" width="8" height="4" fill="#000" />
          <rect x="68" y="58" width="8" height="4" fill="#000" />
          <path d="M 18 110 C 18 110, 20 148, 30 148 H 70 C 80 148, 82 110, 82 110 Z" fill="#0f172a" />
          <circle cx="50" cy="28" r="5" fill="#fffae0" />
          <defs>
            <linearGradient id="rickshawYellow-${imei}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#facc15"/>
              <stop offset="100%" stop-color="#ca8a04"/>
            </linearGradient>
          </defs>
        </svg>`;
    } else { // ace (default fallback)
        size = [30, 60];
        anchor = [15, 30];
        svgHtml = `
        <svg viewBox="0 0 100 200" width="30" height="60" style="display:block;">
          <rect x="8" y="35" width="10" height="25" rx="3" fill="#000" />
          <rect x="82" y="35" width="10" height="25" rx="3" fill="#000" />
          <rect x="8" y="145" width="10" height="25" rx="3" fill="#000" />
          <rect x="82" y="145" width="10" height="25" rx="3" fill="#000" />
          <rect x="40" y="70" width="20" height="80" fill="#1e293b" />
          <rect x="15" y="12" width="70" height="68" rx="15" fill="url(#cabinGrad-${imei})" stroke="#cbd5e1" stroke-width="2" />
          <rect x="3" y="45" width="12" height="8" rx="2" fill="#334155" />
          <rect x="85" y="45" width="12" height="8" rx="2" fill="#334155" />
          <path d="M 22 25 L 26 38 H 74 L 78 25 Z" fill="#94a3b8" opacity="0.8" />
          <rect x="25" y="45" width="50" height="25" rx="5" fill="#94a3b8" opacity="0.3" />
          <rect x="12" y="82" width="76" height="106" rx="4" fill="url(#bedGrad-${imei})" stroke="#1e293b" stroke-width="2" />
          <rect x="16" y="86" width="68" height="98" fill="#1e293b" opacity="0.4" />
          <rect x="48" y="86" width="4" height="98" fill="#475569" opacity="0.7" />
          <circle cx="28" cy="20" r="5" fill="#fffae0" />
          <circle cx="72" cy="20" r="5" fill="#fffae0" />
          <defs>
            <linearGradient id="cabinGrad-${imei}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#ffffff"/>
              <stop offset="100%" stop-color="#e2e8f0"/>
            </linearGradient>
            <linearGradient id="bedGrad-${imei}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#475569"/>
              <stop offset="100%" stop-color="#334155"/>
            </linearGradient>
          </defs>
        </svg>`;
    }
    
    const shadowFilter = `filter: drop-shadow(0 0 5px ${color}) drop-shadow(0 0 1px ${color});`;

    return L.divIcon({
        className: 'custom-vehicle-marker-svg',
        html: `
            <div style="transform: rotate(${heading || 0}deg); ${shadowFilter} width: ${size[0]}px; height: ${size[1]}px; display: flex; align-items: center; justify-content: center;">
                ${svgHtml}
            </div>
        `,
        iconSize: size,
        iconAnchor: anchor,
        popupAnchor: [0, -anchor[1]]
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
