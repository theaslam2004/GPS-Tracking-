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

// Calculate bearing between two coordinates in degrees (0 = North, 90 = East, etc.)
function calculateBearing(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    
    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
              
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
}

// Calculate distance between two coordinates in meters
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6378137; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function updateVehicleOnMap(telemetry, name) {
    const { latitude, longitude, speed, heading, odometer, timestamp } = telemetry;
    
    // Trajectory calculated heading to prevent sideways or backward driving
    let calculatedHeading = heading || 0;
    if (latestTelemetry && latestTelemetry.latitude && latestTelemetry.longitude && latitude && longitude) {
        const dist = calculateDistance(latestTelemetry.latitude, latestTelemetry.longitude, latitude, longitude);
        // Only update heading if the vehicle moved significantly and is moving
        if (dist > 1.5 && speed > 0) {
            calculatedHeading = calculateBearing(latestTelemetry.latitude, latestTelemetry.longitude, latitude, longitude);
            telemetry._calculatedHeading = calculatedHeading;
        } else if (latestTelemetry._calculatedHeading !== undefined) {
            calculatedHeading = latestTelemetry._calculatedHeading;
            telemetry._calculatedHeading = calculatedHeading;
        }
    } else if (heading !== undefined) {
        telemetry._calculatedHeading = heading;
    }
    
    latestTelemetry = telemetry;
    const latlng = [latitude, longitude];
    
    // Update marker
    const isStale = (Date.now() - new Date(timestamp)) > 60000;
    const status = isStale ? 'offline' : (telemetry.status || 'halt');
    const markerIcon = getVehicleIcon(calculatedHeading, status, telemetry.voltage);

    const popupHTML = buildTelemetryHTML(telemetry, name);
    
    if (marker) {
        // Recreate icon only if status changed to avoid Leaflet DOM thrashing
        if (marker.status !== status) {
            marker.setIcon(markerIcon);
            marker.status = status;
        }
        
        // Slide smoothly to new coordinates
        slideMarker(marker, latlng, 1500);
        
        // Rotate heading arrow smoothly
        const element = marker.getElement();
        if (element) {
            const headingArrow = element.querySelector('.heading-arrow');
            if (headingArrow) {
                headingArrow.style.transform = `rotate(${calculatedHeading}deg)`;
            }
        }

        if (marker.isPopupOpen()) {
            marker.getPopup().setContent(popupHTML);
        } else {
            marker.setPopupContent(popupHTML);
        }
    } else {
        marker = L.marker(latlng, { icon: markerIcon }).addTo(map)
            .bindPopup(popupHTML)
            .openPopup();
        marker.status = status;
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
        
        // Breadcrumb trail disabled per user request (remove red lines)
        if (liveTrailPolylines[imei]) {
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
// // Custom vehicle divIcon rotation helper using premium top-down vehicle SVGs based on name, profile, and voltage
function getVehicleIcon(heading, status, voltage) {
    const id = 'share';
    let topColor = '#EF4444'; // Halt (Red)
    let bottomColor = '#B91C1C';
    let statusName = status || 'halt';

    if (statusName === 'running') {
        topColor = '#10B981'; // Moving (Green)
        bottomColor = '#047857';
    } else if (statusName === 'idle') {
        topColor = '#F59E0B'; // Idle (Amber)
        bottomColor = '#D97706';
    } else if (statusName === 'offline') {
        topColor = '#64748B'; // Offline (Gray)
        bottomColor = '#475569';
    }

    const volt = (voltage !== undefined && voltage !== null) ? parseFloat(voltage) : 12;

    let svgContent = '';
    let width = 40;
    let height = 46;

    // Headlight Yellow Glow beams defined safely outside templates with corrected projection angles
    let headlights = '';
    if (statusName === 'running') {
        headlights = `
            <polygon points="9.25,5.2 -10,-25 15,-25 9.25,5.2" fill="url(#lightBeamGrad_${id})" opacity="0.45" style="mix-blend-mode: screen;"/>
            <polygon points="30.75,5.2 25,-25 50,-25 30.75,5.2" fill="url(#lightBeamGrad_${id})" opacity="0.45" style="mix-blend-mode: screen;"/>
        `;
    }

    if (volt <= 16) {
        // Tempo / Delivery Van / Sedan (Ultra Premium Vector Illustration)
        svgContent = `
            <svg width="40" height="46" viewBox="0 0 40 46" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="bodyGrad_${id}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${topColor}"/>
                        <stop offset="30%" stop-color="${topColor}"/>
                        <stop offset="100%" stop-color="${bottomColor}"/>
                    </linearGradient>
                    <linearGradient id="glassGrad_${id}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#38bdf8"/>
                        <stop offset="40%" stop-color="#0284c7"/>
                        <stop offset="100%" stop-color="#0369a1"/>
                    </linearGradient>
                    <linearGradient id="lightBeamGrad_${id}" x1="0%" y1="100%" x2="0%" y2="0%">
                        <stop offset="0%" stop-color="#fef08a" stop-opacity="0.45"/>
                        <stop offset="100%" stop-color="#fef08a" stop-opacity="0"/>
                    </linearGradient>
                    <linearGradient id="chromeGrad_${id}" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="#94a3b8"/>
                        <stop offset="20%" stop-color="#f8fafc"/>
                        <stop offset="50%" stop-color="#cbd5e1"/>
                        <stop offset="80%" stop-color="#f8fafc"/>
                        <stop offset="100%" stop-color="#475569"/>
                    </linearGradient>
                </defs>
                ${headlights}
                <!-- Soft Under-Vehicle Shadow -->
                <rect x="4" y="3" width="32" height="40" rx="8" fill="#000000" opacity="0.28" filter="blur(1.5px)"/>
                <!-- Tires with tread lines -->
                <rect x="2" y="8" width="4" height="8" rx="1.5" fill="#0f172a"/>
                <rect x="34" y="8" width="4" height="8" rx="1.5" fill="#0f172a"/>
                <rect x="2" y="30" width="4" height="8" rx="1.5" fill="#0f172a"/>
                <rect x="34" y="30" width="4" height="8" rx="1.5" fill="#0f172a"/>
                
                <!-- Main Body -->
                <rect x="5.5" y="4" width="29" height="38" rx="7" fill="url(#bodyGrad_${id})" stroke="#ffffff" stroke-width="0.75"/>
                
                <!-- Chrome Front Bumper -->
                <rect x="9" y="3" width="22" height="1.8" rx="0.9" fill="url(#chromeGrad_${id})" stroke="#334155" stroke-width="0.3"/>
                
                <!-- Front Hood / Grill details -->
                <path d="M 12,7.5 L 28,7.5" stroke="#1e293b" stroke-width="0.75" opacity="0.4"/>
                <path d="M 14,9 L 26,9" stroke="#1e293b" stroke-width="0.75" opacity="0.4"/>
                
                <!-- Headlights -->
                <rect x="7" y="5.2" width="4" height="1.8" rx="0.5" fill="#ffffff" stroke="#fef08a" stroke-width="0.5"/>
                <rect x="29" y="5.2" width="4" height="1.8" rx="0.5" fill="#ffffff" stroke="#fef08a" stroke-width="0.5"/>
                <circle cx="9" cy="6.1" r="0.8" fill="#fef08a"/>
                <circle cx="31" cy="6.1" r="0.8" fill="#fef08a"/>

                <!-- Windshield -->
                <path d="M 8.5,14.5 C 8.5,11.5 11.5,9.5 20,9.5 C 28.5,9.5 31.5,11.5 31.5,14.5 L 29.5,18.5 C 29.5,18.5 25,17 20,17 C 15,17 10.5,18.5 10.5,18.5 Z" fill="url(#glassGrad_${id})" stroke="#0f172a" stroke-width="0.5"/>
                <path d="M 11,13 L 29,10" stroke="#ffffff" stroke-width="1.5" opacity="0.45"/>
                
                <!-- Front Wipers -->
                <line x1="14" y1="14" x2="16.5" y2="11.5" stroke="#0f172a" stroke-width="0.8"/>
                <line x1="26" y1="14" x2="23.5" y2="11.5" stroke="#0f172a" stroke-width="0.8"/>
                
                <!-- Side Mirrors (Body Color + Chrome arm) -->
                <path d="M 2.5,12 Q 5,12.5 5.5,13.5" stroke="#cbd5e1" stroke-width="1.5" fill="none"/>
                <path d="M 37.5,12 Q 35,12.5 34.5,13.5" stroke="#cbd5e1" stroke-width="1.5" fill="none"/>
                <rect x="1.5" y="10.5" width="2" height="4" rx="0.7" fill="url(#bodyGrad_${id})"/>
                <rect x="36.5" y="10.5" width="2" height="4" rx="0.7" fill="url(#bodyGrad_${id})"/>
                
                <!-- Side Windows -->
                <path d="M 7.2,20 C 7.2,20 6.5,23 6.5,26 L 7.2,30 C 7.2,30 8,30 8,20 Z" fill="url(#glassGrad_${id})" opacity="0.8"/>
                <path d="M 32.8,20 C 32.8,20 33.5,23 33.5,26 L 32.8,30 C 32.8,30 32,30 32,20 Z" fill="url(#glassGrad_${id})" opacity="0.8"/>

                <!-- Roof Panel / Ribs -->
                <rect x="12" y="21" width="16" height="1.5" rx="0.5" fill="#ffffff" opacity="0.25"/>
                <rect x="12" y="24" width="16" height="1.5" rx="0.5" fill="#ffffff" opacity="0.25"/>
                <rect x="12" y="27" width="16" height="1.5" rx="0.5" fill="#ffffff" opacity="0.25"/>

                <!-- Rear Window -->
                <path d="M 10,34.5 C 10,34.5 14,33 20,33 C 26,33 30,34.5 30,34.5 L 29,37 C 29,37 25,36 20,36 C 15,36 11,37 11,37 Z" fill="url(#glassGrad_${id})" stroke="#0f172a" stroke-width="0.5"/>
                <line x1="20" y1="37" x2="20" y2="41" stroke="#1e293b" stroke-width="0.75" opacity="0.4"/>
                
                <!-- Chrome Rear Bumper -->
                <rect x="9" y="41.2" width="22" height="1.8" rx="0.9" fill="url(#chromeGrad_${id})" stroke="#334155" stroke-width="0.3"/>
                
                <!-- Tail Lights -->
                <rect x="6.8" y="40" width="4.5" height="1.5" rx="0.5" fill="#ef4444"/>
                <rect x="28.7" y="40" width="4.5" height="1.5" rx="0.5" fill="#ef4444"/>
            </svg>
        `;
    } else if (volt > 16 && volt <= 32) {
        // Eicher Truck (Medium Commercial Premium Illustration)
        svgContent = `
            <svg width="40" height="46" viewBox="0 0 40 46" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="bodyGrad_${id}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${topColor}"/>
                        <stop offset="40%" stop-color="${topColor}"/>
                        <stop offset="100%" stop-color="${bottomColor}"/>
                    </linearGradient>
                    <linearGradient id="glassGrad_${id}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#38bdf8"/>
                        <stop offset="50%" stop-color="#0284c7"/>
                        <stop offset="100%" stop-color="#0369a1"/>
                    </linearGradient>
                    <linearGradient id="lightBeamGrad_${id}" x1="0%" y1="100%" x2="0%" y2="0%">
                        <stop offset="0%" stop-color="#fef08a" stop-opacity="0.45"/>
                        <stop offset="100%" stop-color="#fef08a" stop-opacity="0"/>
                    </linearGradient>
                    <linearGradient id="cabGrad_${id}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#f8fafc"/>
                        <stop offset="100%" stop-color="#cbd5e1"/>
                    </linearGradient>
                    <linearGradient id="chromeGrad_${id}" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="#94a3b8"/>
                        <stop offset="20%" stop-color="#f8fafc"/>
                        <stop offset="50%" stop-color="#cbd5e1"/>
                        <stop offset="80%" stop-color="#f8fafc"/>
                        <stop offset="100%" stop-color="#475569"/>
                    </linearGradient>
                </defs>
                ${headlights}
                <!-- Soft Under-Vehicle Shadow -->
                <rect x="3.5" y="3" width="33" height="40" rx="5" fill="#000000" opacity="0.26" filter="blur(1.5px)"/>
                
                <!-- Front Tires -->
                <rect x="2" y="8" width="4.5" height="9" rx="2" fill="#1e293b"/>
                <rect x="33.5" y="8" width="4.5" height="9" rx="2" fill="#1e293b"/>
                <!-- Rear Dual Axle Tires -->
                <rect x="1" y="29" width="5.5" height="9.5" rx="2" fill="#1e293b"/>
                <rect x="33.5" y="29" width="5.5" height="9.5" rx="2" fill="#1e293b"/>
                
                <!-- Side mirrors (Extended chrome arms) -->
                <path d="M 2,12.5 L 6.5,14" stroke="#94a3b8" stroke-width="1.5"/>
                <path d="M 38,12.5 L 33.5,14" stroke="#94a3b8" stroke-width="1.5"/>
                <rect x="1" y="9.5" width="2" height="4.5" rx="0.5" fill="#0f172a"/>
                <rect x="37" y="9.5" width="2" height="4.5" rx="0.5" fill="#0f172a"/>
                
                <!-- Cabin Roof (premium white/silver gradient) -->
                <rect x="6.5" y="5" width="27" height="12.5" rx="2.5" fill="url(#cabGrad_${id})" stroke="#475569" stroke-width="0.75"/>
                
                <!-- Windshield -->
                <path d="M 8.5,12.5 C 8.5,10.5 11.5,9.5 20,9.5 C 28.5,9.5 31.5,10.5 31.5,12.5 L 30.5,15 C 30.5,15 25,14 20,14 C 15,14 9.5,15 9.5,15 Z" fill="url(#glassGrad_${id})" stroke="#0f172a" stroke-width="0.5"/>
                <path d="M 11,11.5 L 29,10" stroke="#ffffff" stroke-width="1.2" opacity="0.45"/>
                
                <!-- Windshield Wipers -->
                <line x1="15" y1="14.5" x2="17.5" y2="11.5" stroke="#0f172a" stroke-width="0.8"/>
                <line x1="25" y1="14.5" x2="22.5" y2="11.5" stroke="#0f172a" stroke-width="0.8"/>

                <!-- Chrome Front Bumper -->
                <rect x="7" y="4" width="26" height="2" rx="1" fill="url(#chromeGrad_${id})" stroke="#475569" stroke-width="0.4"/>
                
                <!-- Cargo Box (back container) -->
                <rect x="5.5" y="18" width="29" height="24" rx="2" fill="url(#bodyGrad_${id})" stroke="#ffffff" stroke-width="0.75"/>
                
                <!-- Ridges on container for premium 3D look -->
                <line x1="7.5" y1="22" x2="32.5" y2="22" stroke="#ffffff" stroke-width="1" opacity="0.3"/>
                <line x1="7.5" y1="26" x2="32.5" y2="26" stroke="#ffffff" stroke-width="1" opacity="0.3"/>
                <line x1="7.5" y1="30" x2="32.5" y2="30" stroke="#ffffff" stroke-width="1" opacity="0.3"/>
                <line x1="7.5" y1="34" x2="32.5" y2="34" stroke="#ffffff" stroke-width="1" opacity="0.3"/>
                <line x1="7.5" y1="38" x2="32.5" y2="38" stroke="#ffffff" stroke-width="1" opacity="0.3"/>
                
                <!-- Headlights -->
                <rect x="8" y="5.2" width="3.5" height="1.8" rx="0.5" fill="#ffffff" stroke="#fef08a" stroke-width="0.5"/>
                <rect x="28.5" y="5.2" width="3.5" height="1.8" rx="0.5" fill="#ffffff" stroke="#fef08a" stroke-width="0.5"/>
                <circle cx="9.75" cy="6.1" r="0.75" fill="#fef08a"/>
                <circle cx="30.25" cy="6.1" r="0.75" fill="#fef08a"/>
                
                <!-- Tail Lights -->
                <rect x="6.8" y="41.5" width="4.5" height="1.2" fill="#ef4444"/>
                <rect x="28.7" y="41.5" width="4.5" height="1.2" fill="#ef4444"/>
            </svg>
        `;
    } else {
        // Heavy 12-Wheel Truck / Trailer (Premium Long Body Semi Truck Illustration)
        width = 40;
        height = 52;
        svgContent = `
            <svg width="40" height="52" viewBox="0 0 40 52" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="bodyGrad_${id}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="${topColor}"/>
                        <stop offset="35%" stop-color="${topColor}"/>
                        <stop offset="100%" stop-color="${bottomColor}"/>
                    </linearGradient>
                    <linearGradient id="glassGrad_${id}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#38bdf8"/>
                        <stop offset="50%" stop-color="#0284c7"/>
                        <stop offset="100%" stop-color="#0369a1"/>
                    </linearGradient>
                    <linearGradient id="lightBeamGrad_${id}" x1="0%" y1="100%" x2="0%" y2="0%">
                        <stop offset="0%" stop-color="#fef08a" stop-opacity="0.45"/>
                        <stop offset="100%" stop-color="#fef08a" stop-opacity="0"/>
                    </linearGradient>
                    <linearGradient id="cabGrad_${id}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#f8fafc"/>
                        <stop offset="100%" stop-color="#94a3b8"/>
                    </linearGradient>
                    <linearGradient id="chromeGrad_${id}" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="#94a3b8"/>
                        <stop offset="20%" stop-color="#f8fafc"/>
                        <stop offset="50%" stop-color="#cbd5e1"/>
                        <stop offset="80%" stop-color="#f8fafc"/>
                        <stop offset="100%" stop-color="#475569"/>
                    </linearGradient>
                </defs>
                ${headlights}
                <!-- Soft Under-Vehicle Shadow -->
                <rect x="3.5" y="3" width="33" height="46" rx="5" fill="#000000" opacity="0.28" filter="blur(1.8px)"/>
                
                <!-- Front Tires -->
                <rect x="2" y="8" width="4.5" height="9" rx="2" fill="#1e293b"/>
                <rect x="33.5" y="8" width="4.5" height="9" rx="2" fill="#1e293b"/>
                
                <!-- Middle Axle Tires (cab rear) -->
                <rect x="1.5" y="21" width="5" height="9" rx="2" fill="#1e293b"/>
                <rect x="33.5" y="21" width="5" height="9" rx="2" fill="#1e293b"/>
                
                <!-- Rear Axle 1 Tires (trailer rear front) -->
                <rect x="1.5" y="35" width="5" height="9" rx="2" fill="#1e293b"/>
                <rect x="33.5" y="35" width="5" height="9" rx="2" fill="#1e293b"/>
                
                <!-- Rear Axle 2 Tires (trailer rear back) -->
                <rect x="1.5" y="42" width="5" height="9" rx="2" fill="#1e293b"/>
                <rect x="33.5" y="42" width="5" height="9" rx="2" fill="#1e293b"/>
                
                <!-- Extended Chrome Side Mirrors -->
                <path d="M 2,12.5 L 6.5,14" stroke="#94a3b8" stroke-width="1.75"/>
                <path d="M 38,12.5 L 33.5,14" stroke="#94a3b8" stroke-width="1.75"/>
                <rect x="1" y="9.5" width="2" height="5" rx="0.5" fill="#475569"/>
                <rect x="37" y="9.5" width="2" height="5" rx="0.5" fill="#475569"/>
                
                <!-- Cabin (Robust Front Heavy Truck Nose) -->
                <rect x="6.5" y="5" width="27" height="13.5" rx="3.5" fill="url(#cabGrad_${id})" stroke="#475569" stroke-width="0.75"/>
                
                <!-- Chrome Exhaust Stacks (Tall pipes on sides) -->
                <line x1="12" y1="5" x2="12" y2="8" stroke="#f8fafc" stroke-width="1.5"/>
                <line x1="28" y1="5" x2="28" y2="8" stroke="#f8fafc" stroke-width="1.5"/>
                <circle cx="12" cy="4.5" r="0.75" fill="#cbd5e1"/>
                <circle cx="28" cy="4.5" r="0.75" fill="#cbd5e1"/>
                
                <!-- Windshield -->
                <path d="M 8.5,11.5 C 8.5,9.5 11.5,8.5 20,8.5 C 28.5,8.5 31.5,9.5 31.5,11.5 L 30.5,13.5 C 30.5,13.5 25,12.5 20,12.5 C 15,12.5 9.5,13.5 9.5,13.5 Z" fill="url(#glassGrad_${id})" stroke="#0f172a" stroke-width="0.5"/>
                <path d="M 11,10.5 L 29,9.5" stroke="#ffffff" stroke-width="1.2" opacity="0.45"/>
                
                <!-- Windshield Wipers -->
                <line x1="15" y1="13.5" x2="17.5" y2="10.5" stroke="#0f172a" stroke-width="0.8"/>
                <line x1="25" y1="13.5" x2="22.5" y2="10.5" stroke="#0f172a" stroke-width="0.8"/>

                <!-- Fifth Wheel Connection Deck -->
                <rect x="13.5" y="18.5" width="13" height="4.5" rx="1.2" fill="#334155" stroke="#1e293b" stroke-width="0.5"/>
                
                <!-- Long Cargo Trailer -->
                <rect x="5.5" y="24" width="29" height="24" rx="2" fill="url(#bodyGrad_${id})" stroke="#ffffff" stroke-width="0.75"/>
                
                <!-- Ridges on container for premium 3D look -->
                <line x1="7.5" y1="28" x2="32.5" y2="28" stroke="#ffffff" stroke-width="1" opacity="0.3"/>
                <line x1="7.5" y1="32" x2="32.5" y2="32" stroke="#ffffff" stroke-width="1" opacity="0.3"/>
                <line x1="7.5" y1="36" x2="32.5" y2="36" stroke="#ffffff" stroke-width="1" opacity="0.3"/>
                <line x1="7.5" y1="40" x2="32.5" y2="40" stroke="#ffffff" stroke-width="1" opacity="0.3"/>
                <line x1="7.5" y1="44" x2="32.5" y2="44" stroke="#ffffff" stroke-width="1" opacity="0.3"/>
                
                <!-- Chrome Front Grill Vertical lines -->
                <line x1="14" y1="5.5" x2="26" y2="5.5" stroke="#94a3b8" stroke-width="1.2"/>
                <line x1="16" y1="5.5" x2="16" y2="7.5" stroke="#cbd5e1" stroke-width="0.8"/>
                <line x1="18" y1="5.5" x2="18" y2="7.5" stroke="#cbd5e1" stroke-width="0.8"/>
                <line x1="20" y1="5.5" x2="20" y2="7.5" stroke="#cbd5e1" stroke-width="0.8"/>
                <line x1="22" y1="5.5" x2="22" y2="7.5" stroke="#cbd5e1" stroke-width="0.8"/>
                <line x1="24" y1="5.5" x2="24" y2="7.5" stroke="#cbd5e1" stroke-width="0.8"/>
                
                <!-- LED Headlights -->
                <rect x="8" y="5.2" width="3.5" height="1.8" rx="0.5" fill="#ffffff" stroke="#fef08a" stroke-width="0.5"/>
                <rect x="28.5" y="5.2" width="3.5" height="1.8" rx="0.5" fill="#ffffff" stroke="#fef08a" stroke-width="0.5"/>
                <circle cx="9.75" cy="6.1" r="0.75" fill="#fef08a"/>
                <circle cx="30.25" cy="6.1" r="0.75" fill="#fef08a"/>
                
                <!-- Tail Lights -->
                <rect x="7.2" y="47.5" width="4.5" height="1.5" rx="0.5" fill="#ef4444"/>
                <rect x="28.5" y="47.5" width="4.5" height="1.5" rx="0.5" fill="#ef4444"/>
            </svg>
        `;
    }

    // Border and shadow styling for pinning/beacons
    let borderStyle = 'border: 1.5px solid rgba(255, 255, 255, 0.4); box-shadow: 0 0 8px ' + topColor + ';';
    const pulseClass = (statusName === 'running') ? 'beacon-pulse' : '';

    // Inline styles for exhaust smoke drift animation (only when running)
    let smokeHTML = '';
    if (statusName === 'running') {
        smokeHTML = `
            <div class="smoke-container">
                <div class="smoke-puff smoke-puff-1"></div>
                <div class="smoke-puff smoke-puff-2"></div>
                <div class="smoke-puff smoke-puff-3"></div>
            </div>
            <style>
                @keyframes smoke-drift {
                    0% {
                        transform: translate(-50%, 0) scale(0.3);
                        opacity: 0.7;
                    }
                    50% {
                        opacity: 0.4;
                    }
                    100% {
                        transform: translate(-50%, 20px) scale(2.0);
                        opacity: 0;
                    }
                }
                .smoke-container {
                    position: absolute;
                    bottom: -8px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 12px;
                    height: 12px;
                    pointer-events: none;
                    z-index: -1;
                }
                .smoke-puff {
                    position: absolute;
                    bottom: 0;
                    left: 50%;
                    width: 6px;
                    height: 6px;
                    background: radial-gradient(circle, rgba(160,160,160,0.6) 0%, rgba(200,200,200,0) 80%);
                    border-radius: 50%;
                    transform-origin: bottom center;
                    animation: smoke-drift 1.2s infinite ease-out;
                }
                .smoke-puff-2 {
                    animation-delay: 0.4s;
                }
                .smoke-puff-3 {
                    animation-delay: 0.8s;
                }
            </style>
        `;
    }

    return L.divIcon({
        className: 'custom-vehicle-marker-svg',
        html: `
            <div style="position: relative; width: 48px; height: 56px; display: flex; align-items: center; justify-content: center;">
                <div class="heading-arrow" style="transform: rotate(${heading || 0}deg); transition: transform 0.4s ease-out; width: ${width}px; height: ${height}px; display: flex; align-items: center; justify-content: center; transform-origin: center center;">
                    ${svgContent}
                    ${smokeHTML}
                </div>
            </div>
        `,
        iconSize: [48, 56],
        iconAnchor: [24, 28],
        popupAnchor: [0, -24]
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

// Smoothly slides a marker to a new position using requestAnimationFrame
function slideMarker(marker, newLatLng, duration = 1500) {
    if (!marker) return;
    if (!newLatLng || isNaN(newLatLng[0]) || isNaN(newLatLng[1])) return;
    const startLatLng = marker.getLatLng();
    const endLatLng = L.latLng(newLatLng);
    
    if (!startLatLng || typeof startLatLng.distanceTo !== 'function') {
        marker.setLatLng(endLatLng);
        return;
    }
    
    // If it's a huge distance jump (like loading a new device or first load), snap instantly
    const distance = startLatLng.distanceTo(endLatLng);
    if (distance > 5000 || distance < 0.1) {
        marker.setLatLng(endLatLng);
        return;
    }
    
    // Cancel any existing animation on this marker
    if (marker._slideAnimationId) {
        cancelAnimationFrame(marker._slideAnimationId);
    }
    
    const startTime = performance.now();
    
    function animate(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Easing function: easeOutCubic
        const ease = 1 - Math.pow(1 - progress, 3);
        
        const lat = startLatLng.lat + (endLatLng.lat - startLatLng.lat) * ease;
        const lng = startLatLng.lng + (endLatLng.lng - startLatLng.lng) * ease;
        
        marker.setLatLng([lat, lng]);
        
        if (progress < 1) {
            marker._slideAnimationId = requestAnimationFrame(animate);
        } else {
            marker._slideAnimationId = null;
            marker._lastDeadReckonTick = Date.now();
        }
    }
    
    marker._slideAnimationId = requestAnimationFrame(animate);
}

// Dead Reckoning Loop for continuous smooth marker movement between packets
setInterval(() => {
    const now = Date.now();
    if (!marker) return;
    
    // Skip dead reckoning if the marker is currently sliding to a new packet coordinate
    if (marker._slideAnimationId) return;
    
    const data = latestTelemetry;
    if (!data) return;
    
    // Extrapolate strictly based on speed to prevent any stuck state regardless of status updates
    const speed = data.speed !== undefined ? parseFloat(data.speed) : 0;
    const heading = data._calculatedHeading !== undefined ? parseFloat(data._calculatedHeading) : (data.heading !== undefined ? parseFloat(data.heading) : 0);
    
    if (speed > 0) {
        const lastSeenTime = data.timestamp ? new Date(data.timestamp).getTime() : 0;
        const timeSinceLastPacket = now - lastSeenTime;
        
        // Only extrapolate if we received a packet recently (within 30 seconds)
        if (timeSinceLastPacket > 0 && timeSinceLastPacket < 30000) {
            const lastTick = marker._lastDeadReckonTick || now;
            const elapsedSeconds = (now - lastTick) / 1000;
            marker._lastDeadReckonTick = now;
            
            if (elapsedSeconds > 0 && elapsedSeconds < 2) {
                const distance = (speed / 3.6) * elapsedSeconds;
                
                const currentLatLng = marker.getLatLng();
                const earthRadius = 6378137;
                const headingRad = (heading * Math.PI) / 180;
                
                const dLat = (distance * Math.cos(headingRad)) / earthRadius;
                const dLng = (distance * Math.sin(headingRad)) / (earthRadius * Math.cos((currentLatLng.lat * Math.PI) / 180));
                
                const newLat = currentLatLng.lat + (dLat * 180) / Math.PI;
                const newLng = currentLatLng.lng + (dLng * 180) / Math.PI;
                
                const newLatLng = [newLat, newLng];
                marker.setLatLng(newLatLng);
                
                // Pan map smoothly to follow marker
                map.panTo(newLatLng);
            }
        } else {
            marker._lastDeadReckonTick = null;
        }
    } else {
        marker._lastDeadReckonTick = null;
    }
}, 100);
