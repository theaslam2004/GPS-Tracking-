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
    const isStale = (Date.now() - new Date(timestamp)) > 120000;
    
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
    const isStale = (Date.now() - new Date(timestamp)) > 120000;
    const status = isStale ? 'offline' : (telemetry.status || 'halt');
    const markerIcon = getVehicleIcon(heading, status, telemetry.voltage);

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
                headingArrow.style.transform = `rotate(${heading || 0}deg)`;
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
    map.panTo(latlng, { animate: false });
    
    // Draw 1-minute breadcrumb trail (dashed line)
    if (latitude && longitude && latitude !== 0 && longitude !== 0 && targetImei) {
        const imei = targetImei;
        if (!liveTrails[imei]) {
            liveTrails[imei] = [];
        }
        
        // Push the current position of the marker before sliding as a confirmed point
        if (marker) {
            const currentLatLng = marker.getLatLng();
            const lastPt = liveTrails[imei][liveTrails[imei].length - 1];
            const timestampMs = new Date(timestamp).getTime();
            if (!lastPt || lastPt.lat !== currentLatLng.lat || lastPt.lng !== currentLatLng.lng) {
                liveTrails[imei].push({ lat: currentLatLng.lat, lng: currentLatLng.lng, timestamp: timestampMs });
            } else if (lastPt) {
                lastPt.timestamp = timestampMs;
            }
        } else {
            // First load: initialize with start coordinate
            const timestampMs = new Date(timestamp).getTime();
            liveTrails[imei].push({ lat: latitude, lng: longitude, timestamp: timestampMs });
        }
        
        updateTrail(imei, marker ? marker.getLatLng() : { lat: latitude, lng: longitude });
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
    let color = '#FF3D00'; // Halt (Red)
    if (status === 'running') {
        color = '#00E676'; // Moving (Green)
    } else if (status === 'idle') {
        color = '#FFab00'; // Idle (Amber)
    } else if (status === 'offline') {
        color = '#94a3b8'; // Offline (Gray)
    }
    
    let borderStyle = 'border: 1.5px solid rgba(255, 255, 255, 0.4); box-shadow: 0 0 8px ' + color + ';';
    const pulseClass = (status === 'running') ? 'beacon-pulse' : '';
    
    return L.divIcon({
        className: 'custom-vehicle-marker-svg',
        html: `
            <div class="vehicle-beacon ${pulseClass}" style="background: ${color}; color: ${color}; ${borderStyle} width: 28px; height: 28px;">
                <div class="heading-arrow" style="transform: rotate(${heading || 0}deg); color: #ffffff; transition: transform 0.4s ease-out; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
                    <i class="fa-solid fa-location-arrow" style="transform: rotate(-45deg); display: inline-block;"></i>
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
    const oneMinuteAgo = Date.now() - 120000;
    if (targetImei && liveTrails[targetImei]) {
        const imei = targetImei;
        liveTrails[imei] = liveTrails[imei].filter(pt => pt.timestamp >= oneMinuteAgo);
        if (marker) {
            updateTrail(imei, marker.getLatLng());
        } else if (liveTrails[imei].length > 0) {
            const last = liveTrails[imei][liveTrails[imei].length - 1];
            updateTrail(imei, { lat: last.lat, lng: last.lng });
        } else {
            updateTrail(imei, null);
        }
    }
}, 1000); // Check every second for a smoother trail decay

function updateTrail(imei, currentLatLng) {
    if (!liveTrails[imei]) {
        liveTrails[imei] = [];
    }
    
    const oneMinuteAgo = Date.now() - 120000;
    liveTrails[imei] = liveTrails[imei].filter(pt => pt.timestamp >= oneMinuteAgo);
    
    const latlngs = liveTrails[imei].map(pt => [pt.lat, pt.lng]);
    
    if (currentLatLng) {
        latlngs.push([currentLatLng.lat, currentLatLng.lng]);
    }
    
    if (latlngs.length >= 2) {
        if (liveTrailPolylines[imei]) {
            liveTrailPolylines[imei].setLatLngs(latlngs);
        } else {
            liveTrailPolylines[imei] = L.polyline(latlngs, {
                color: '#38bdf8', // Sleek modern sky blue
                weight: 5,
                dashArray: '0, 12', // Perfect circular dots
                opacity: 0.9,
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(map);
        }
    } else if (liveTrailPolylines[imei]) {
        map.removeLayer(liveTrailPolylines[imei]);
        delete liveTrailPolylines[imei];
    }
}

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
        
        // Update the trail polylines smoothly frame-by-frame
        if (targetImei) {
            updateTrail(targetImei, { lat, lng });
        }
        
        // Center the map on the vehicle in the share view smoothly frame-by-frame
        map.panTo([lat, lng], { animate: false });
        
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
    
    // Extrapolate if running and moving
    const isRunning = (data.status === 'running' || marker.status === 'running');
    const speed = data.speed !== undefined ? data.speed : 0;
    const heading = data.heading !== undefined ? data.heading : 0;
    
    if (isRunning && speed > 0) {
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
                
                // Update trail smoothly during dead reckoning
                if (targetImei) {
                    updateTrail(targetImei, { lat: newLat, lng: newLng });
                }
                
                // Pan map smoothly to follow marker
                map.panTo(newLatLng, { animate: false });
            }
        } else {
            marker._lastDeadReckonTick = null;
        }
    } else {
        marker._lastDeadReckonTick = null;
    }
}, 100);
