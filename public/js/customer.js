// Global Error Catcher for Debugging
window.onerror = function(message, source, lineno, colno, error) {
    console.error('GLOBAL ERROR:', message, 'at', source, ':', lineno);
    if(typeof showToast === 'function') {
        showToast("🚨 System Error", `${message} (Line: ${lineno})`, "danger");
    }
    return false;
};

// Auto-migrate legacy user sessions without ID to prevent unexpected redirects
let user = JSON.parse(localStorage.getItem('user'));
if (user && !user.id) {
    if (user.username === 'testcustomer') user.id = 'test-customer-1';
    else if (user.username === 'admin') user.id = '1';
    localStorage.setItem('user', JSON.stringify(user));
}

console.log('[Auth Check] User:', user);
if (!user || !user.id || user.role !== 'customer') {
    console.warn('[Auth Check] Access Denied or Session Stale. Redirecting to login...');
    localStorage.removeItem('user');
    window.location.href = 'index.html';
}

// Setup Export link
document.getElementById('exportBtn').href = `/api/export/devices?userId=${user.id}&role=${user.role}`;

let map;
const markers = {};
const livePaths = {}; // Store L.polyline paths for breadcrumbs
let myDevices = [];
let latestData = {}; // Store latest telemetry for panel
let activeImei = null;
let userSettings = {};

function isFeatureEnabled(imei, feature) {
    if (!imei) return true;
    const settings = userSettings[imei] || {};
    return settings[feature] !== false;
}

// ==========================================
// Toast Notification Logic
// ==========================================
function showToast(title, message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-alert ${type}`;
    
    let iconClass = 'fa-circle-info';
    if (type === 'danger') iconClass = 'fa-triangle-exclamation';
    if (type === 'warning') iconClass = 'fa-bolt';

    toast.innerHTML = `
        <i class="fa-solid ${iconClass} toast-icon"></i>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.classList.add('toast-hiding'); setTimeout(() => this.parentElement.remove(), 400);"><i class="fa-solid fa-xmark"></i></button>
    `;

    container.appendChild(toast);

    // Auto remove after 5 seconds
    setTimeout(() => {
        if(toast.parentElement) {
            toast.classList.add('toast-hiding');
            setTimeout(() => {
                if(toast.parentElement) toast.remove();
            }, 400);
        }
    }, 5000);
}

// Map Layers
const mapLayers = {
    standard: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri' })
};
let currentLayerName = 'standard';

let drawnItems;
let drawControl;

function initMap() {
    map = L.map('map').setView([20.5937, 78.9629], 5);
    mapLayers.standard.addTo(map);
    
    // Geofence Drawing Layer
    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    
    // We handle drawing programmatically via the new horizontal toolbar
    
    map.on(L.Draw.Event.CREATED, async function (e) {
        const type = e.layerType;
        const layer = e.layer;
        console.log('[Geofence] Shape Created:', type);
        
        // Use a default name to avoid blocking browser prompts
        const gfName = `Zone ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
        let gfData = { userId: user.id, name: gfName };
        
        if (type === 'circle') {
            gfData.type = 'circle';
            const latlng = layer.getLatLng();
            gfData.points = [[latlng.lat, latlng.lng]];
            gfData.radius = layer.getRadius();
        } else if (type === 'polygon') {
            gfData.type = 'polygon';
            const latlngs = layer.getLatLngs()[0]; // outer ring
            gfData.points = latlngs.map(ll => [ll.lat, ll.lng]);
        }
        
        console.log('[Geofence] Sending to server:', gfData);
        
        try {
            const res = await fetch('/api/customer/geofence', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(gfData)
            });
            const saved = await res.json();
            
            if(saved.id) {
                showToast("✅ Saved", `Geofence '${gfName}' created successfully.`, "success");
                layer.gfId = saved.id;
                drawnItems.addLayer(layer);
                loadGeofences(); // refresh list
            } else {
                showToast("❌ Error", "Server failed to save geofence.", "danger");
            }
        } catch (err) {
            console.error('[Geofence] Save Error:', err);
            showToast("❌ Error", "Could not connect to server.", "danger");
        }
        
        exitGeofenceMode(); // Go back to normal UI
    });
}

function toggleMapStyle() {
    map.removeLayer(mapLayers[currentLayerName]);
    if (currentLayerName === 'standard') currentLayerName = 'dark';
    else if (currentLayerName === 'dark') currentLayerName = 'satellite';
    else currentLayerName = 'standard';
    mapLayers[currentLayerName].addTo(map);
}

function logout() {
    localStorage.removeItem('user');
    window.location.href = 'index.html';
}

function showAddDeviceModal() { document.getElementById('addDeviceModal').classList.add('active'); }
function closeAddDeviceModal() { document.getElementById('addDeviceModal').classList.remove('active'); }

function showPanicAlert(data) {
    const modal = document.getElementById('panicModal');
    const msg = document.getElementById('panicMessage');
    const trackBtn = document.getElementById('panicTrackBtn');
    
    msg.innerHTML = `Emergency signal received from <b>${data.deviceName}</b>.<br>Time: ${new Date(data.time).toLocaleTimeString()}`;
    document.body.classList.add('panic-active');
    modal.classList.add('active');
    
    // Play alert sound
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/951/951-preview.mp3');
    audio.play().catch(e => console.warn('Audio playback blocked by browser'));

    trackBtn.onclick = () => {
        map.flyTo([data.lat, data.lng], 18, { animate: true, duration: 2 });
        closePanic();
    };
}

function closePanic() {
    document.getElementById('panicModal').classList.remove('active');
    document.body.classList.remove('panic-active');
}

async function submitDeviceRequest() {
    const imei = document.getElementById('newImei').value;
    if(!imei) return alert('Enter IMEI');
    
    const res = await fetch('/api/customer/request-device', {
        method: 'POST',
        headers:{'Content-Type': 'application/json'},
        body: JSON.stringify({ userId: user.id, imei })
    });
    const data = await res.json();
    if(data.success) {
        alert('Request sent to admin for approval!');
        closeAddDeviceModal();
    } else {
        alert(data.error);
    }
}

async function loadData() {
    try {
        const res = await fetch(`/api/customer/data?userId=${user.id}`);
        const data = await res.json();
        
        myDevices = data.devices || [];
        latestData = data.lastSeen || {};
        
        // Fetch Per-Device Settings
        try {
            const settingsRes = await fetch(`/api/customer/settings?userId=${user.id}`);
            userSettings = await settingsRes.json();
            console.log('[Settings] Loaded Map:', userSettings);
        } catch(e) {
            console.warn('[Settings] Failed to load settings, using empty defaults.');
            userSettings = {};
        }

        loadGeofences();
        
        if (data.subscription) {
            const expDate = new Date(data.subscription.expirationDate);
            const daysLeft = Math.ceil((expDate - new Date()) / (1000 * 60 * 60 * 24));
            document.getElementById('validityDays').innerText = `${daysLeft > 0 ? daysLeft : 0} days left`;
            
            if(daysLeft <= 0) {
                document.getElementById('subBanner').style.background = '#fee2e2';
                document.getElementById('lockoutOverlay').classList.add('active');
            }
        }
        
        renderDeviceList();
        
        // Render last seen locations and paths on map immediately
        Object.keys(latestData).forEach(imei => {
            const deviceData = latestData[imei];
            if (deviceData) {
                deviceData.imei = imei;
                deviceData.ownerId = user.id;
                handleDeviceData(deviceData, false);
            }
        });
        
        // Expose settings to window context for debugging
        window.userSettings = userSettings;
        window.activeImei = activeImei;
        
        // Focus first/pinned device
        const pinnedDev = myDevices.find(d => d.pinned);
        const defaultDev = pinnedDev || myDevices[0];
        if (defaultDev && latestData[defaultDev.imei]) {
            window.initialFocusDone = true;
            focusDevice(defaultDev.imei);
        }
        
        // Global Feature Visibility
        const anyGeofenceEnabled = myDevices.some(d => isFeatureEnabled(d.imei, 'geofenceAlert'));
        const geofenceBtn = document.getElementById('geofenceToggleBtn');
        if (geofenceBtn) {
            geofenceBtn.style.display = anyGeofenceEnabled ? 'block' : 'none';
        }
    } catch(err) {
        console.error('[loadData] Error:', err);
    }
}

async function loadGeofences() {
    const res = await fetch(`/api/customer/geofences?userId=${user.id}`);
    const geofences = await res.json();
    
    const list = document.getElementById('geofenceItems');
    if(!list) return;
    list.innerHTML = '';
    drawnItems.clearLayers();
    
    geofences.forEach(gf => {
        // Draw on map
        let layer;
        if (gf.type === 'circle') {
            layer = L.circle(gf.points[0], { radius: gf.radius, color: 'var(--primary)', weight: 2, fillOpacity: 0.1 });
        } else if (gf.type === 'polygon') {
            layer = L.polygon(gf.points, { color: 'var(--primary)', weight: 2, fillOpacity: 0.1 });
        }
        if(layer) {
            layer.gfId = gf.id;
            layer.bindPopup(`<b>${gf.name}</b>`);
            drawnItems.addLayer(layer);
        }
        
        // Add to sidebar list
        list.innerHTML += `
            <div class="geofence-item">
                <div class="geofence-info" onclick="focusGeofence('${gf.id}')">
                    <i class="fa-solid fa-draw-polygon"></i>
                    <span>${gf.name}</span>
                </div>
                <div class="geofence-actions">
                    <button onclick="openEditModal('${gf.id}', '${gf.name}')" title="Rename"><i class="fa-solid fa-pencil"></i></button>
                    <button onclick="deleteGeofence('${gf.id}')" title="Delete" class="delete-btn"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `;
    });
}

function focusGeofence(id) {
    const layer = drawnItems.getLayers().find(l => l.gfId === id);
    if(layer) {
        if(layer.getBounds) map.fitBounds(layer.getBounds());
        else if(layer.getLatLng) map.setView(layer.getLatLng(), 16);
        layer.openPopup();
    }
}

function openEditModal(id, name) {
    document.getElementById('editGfId').value = id;
    document.getElementById('editGfName').value = name;
    document.getElementById('editGeofenceModal').classList.add('active');
}

function closeEditGeofenceModal() { document.getElementById('editGeofenceModal').classList.remove('active'); }

async function submitEditGeofence() {
    const idField = document.getElementById('editGfId');
    const nameField = document.getElementById('editGfName');
    
    if(!idField || !nameField) {
        return showToast("❌ Error", "UI Elements missing.", "danger");
    }

    const id = idField.value;
    const newName = nameField.value;
    
    if(!newName) return showToast("⚠️ Warning", "Please enter a name.", "warning");
    
    try {
        const res = await fetch('/api/customer/geofence/update/' + id, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });
        
        if(!res.ok) throw new Error('Server returned ' + res.status);
        
        const result = await res.json();
        
        if(result.success) {
            showToast("✅ Success", `Zone renamed to '${newName}'`, "success");
            closeEditGeofenceModal();
            loadGeofences(); // Refresh the list
        } else {
            showToast("❌ Error", "Could not save the new name.", "danger");
        }
    } catch (err) {
        console.error('[Geofence] Rename Error:', err);
        showToast("❌ Error", "Connection failed. Please try again.", "danger");
    }
}

async function deleteGeofence(id) {
    // Silent delete for smoother experience, or we could use a custom modal
    // For now, let's just do it directly to ensure it works for you
    try {
        const res = await fetch(`/api/customer/geofence/${id}`, { method: 'DELETE' });
        if(res.ok) {
            showToast("🗑️ Deleted", "Geofence removed.", "info");
            loadGeofences();
        }
    } catch (e) {
        console.error('Delete failed', e);
    }
}

let geofenceMode = false;
function toggleGeofenceMode() {
    geofenceMode = !geofenceMode;
    const btn = document.getElementById('geofenceToggleBtn');
    const panel = document.getElementById('geofenceList');
    
    if (geofenceMode) {
        btn.classList.add('active');
        btn.style.background = 'var(--primary)';
        btn.style.color = '#fff';
        panel.style.display = 'block';
    } else {
        btn.classList.remove('active');
        btn.style.background = 'transparent';
        btn.style.color = 'var(--text-primary)';
        panel.style.display = 'none';
        exitGeofenceMode();
    }
}

function startPolygonDraw() {
    new L.Draw.Polygon(map).enable();
    document.body.classList.add('in-geofence-mode');
    document.getElementById('geofenceHeader').querySelector('span').innerText = "Click on the map to start drawing your area.";
}

function startCircleDraw() {
    new L.Draw.Circle(map).enable();
    document.body.classList.add('in-geofence-mode');
    document.getElementById('geofenceHeader').querySelector('span').innerText = "Click and drag on the map to define the circle radius.";
}

function centerOnUser() {
    if (navigator.geolocation) {
        showToast("📍 Location Access", "Fetching your location...", "info");
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                map.flyTo([lat, lng], 16, { animate: true, duration: 1.5 });
                
                const hereMarker = L.marker([lat, lng], {
                    icon: L.divIcon({
                        className: 'user-location-beacon',
                        iconSize: [14, 14],
                        iconAnchor: [7, 7]
                    })
                }).addTo(map);
                
                hereMarker.bindPopup('<b style="font-family:Outfit, sans-serif; letter-spacing: 0.5px;">📍 You are here</b>', {
                    offset: [0, -10],
                    className: 'premium-tooltip'
                }).openPopup();
                
                setTimeout(() => map.removeLayer(hereMarker), 8000);
            },
            (err) => showToast("❌ Failed", "Could not get location.", "danger")
        );
    }
}

function showManualGeofenceModal() { document.getElementById('manualGeofenceModal').classList.add('active'); }
function closeManualGeofenceModal() { document.getElementById('manualGeofenceModal').classList.remove('active'); }

async function submitManualGeofence() {
    const name = document.getElementById('manualGfName').value;
    const lat = parseFloat(document.getElementById('manualLat').value);
    const lng = parseFloat(document.getElementById('manualLng').value);
    const radius = parseFloat(document.getElementById('manualRadius').value);
    
    if(!name || isNaN(lat) || isNaN(lng)) return alert('Please fill all required fields');
    
    const gfData = {
        userId: user.id,
        name: name,
        type: 'circle',
        points: [[lat, lng]],
        radius: radius
    };
    
    const res = await fetch('/api/customer/geofence', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(gfData)
    });
    
    if(res.ok) {
        showToast("✅ Success", `Zone '${name}' created manually.`, "success");
        closeManualGeofenceModal();
        loadGeofences();
        map.flyTo([lat, lng], 15);
    }
}

function startDrawingGeofence() {
    // This is now replaced by startPolygonDraw and startCircleDraw
    if(!geofenceMode) toggleGeofenceMode();
}

function exitGeofenceMode() {
    document.body.classList.remove('in-geofence-mode');
    if (window.tempHereMarker) {
        map.removeLayer(window.tempHereMarker);
        window.tempHereMarker = null;
    }
}

async function togglePin(imei, event) {
    if(event) event.stopPropagation();
    try {
        const res = await fetch('/api/customer/pin-device', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ userId: user.id, imei })
        });
        const data = await res.json();
        if(data.success) {
            const device = myDevices.find(d => d.imei === imei);
            if(device) device.pinned = data.pinned;
            renderDeviceList();
        }
    } catch(e) {
        console.error('Failed to pin device', e);
    }
}

function renderDeviceList() {
    const container = document.getElementById('deviceList');
    if (myDevices.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); margin-top: 2rem;">No devices found. Request one to start tracking.</div>';
        return;
    }
    
    // Sort pinned devices to the top
    const sortedDevices = [...myDevices].sort((a, b) => {
        if(a.pinned && !b.pinned) return -1;
        if(!a.pinned && b.pinned) return 1;
        return String(a.name || a.imei).localeCompare(String(b.name || b.imei));
    });
    
    container.innerHTML = sortedDevices.map(d => {
        const odoHidden = !isFeatureEnabled(d.imei, 'odometer') ? 'display:none' : '';
        const speedHidden = !isFeatureEnabled(d.imei, 'speedAlert') ? 'display:none' : '';
        
        // Use live telemetry values if available
        const live = latestData[d.imei] || {};
        const speedVal = live.speed !== undefined ? live.speed : 0;
        const odoVal = live.odometer !== undefined ? live.odometer.toFixed(1) : (d.odometer || 0);
        const timeVal = live.timestamp ? new Date(live.timestamp).toLocaleTimeString() : '--';
        
        // Offline status check
        let statusText = 'Offline';
        let statusColor = 'var(--text-secondary)';
        if (live.timestamp) {
            const isStale = (Date.now() - new Date(live.timestamp)) > 30000;
            if (!isStale) {
                statusText = live.speed > 5 ? 'Running' : 'Idle';
                statusColor = live.speed > 5 ? 'var(--success)' : 'var(--warning)';
            }
        }
        
        return `
            <div class="device-card" id="card-${d.imei}" onclick="focusDevice('${d.imei}')">
                <div class="device-header">
                    <div class="device-title">
                        <i class="fa-solid fa-star" style="color: ${d.pinned ? 'var(--warning)' : 'var(--text-secondary)'}; opacity: ${d.pinned ? '1' : '0.5'}; cursor: pointer; margin-right: 6px; transition: all 0.2s;" onclick="togglePin('${d.imei}', event)" title="${d.pinned ? 'Unpin' : 'Pin to top'}"></i>
                        <i class="fa-solid fa-truck"></i> ${d.name || d.imei}
                    </div>
                    <div style="font-weight: 700; font-size: 0.8rem; color: ${statusColor};" id="status-${d.imei}">${statusText}</div>
                </div>
                <div class="device-stats" style="display: flex; justify-content: space-between; font-size: 0.75rem; padding-top: 8px;">
                    <div class="stat-item" style="${speedHidden}"><i class="fa-solid fa-gauge-high"></i> <span id="speed-${d.imei}">${speedVal}</span> km/h</div>
                    <div class="stat-item" style="${odoHidden}"><i class="fa-solid fa-road"></i> <span id="odo-${d.imei}">${odoVal}</span> km</div>
                    <div class="stat-item"><i class="fa-regular fa-clock"></i> <span id="time-${d.imei}">${timeVal}</span></div>
                </div>
            </div>
        `;
    }).join('');
    
    document.getElementById('countAll').innerText = myDevices.length;
    updateFleetCounts();
}

function updateFleetCounts() {
    let active = 0;
    let idle = 0;
    let offline = 0;
    
    // Scan all devices for current status
    myDevices.forEach(device => {
        const data = latestData[device.imei];
        if (data) {
            // Check if data is "Fresh" (within last 30 seconds)
            const isStale = (Date.now() - new Date(data.timestamp)) > 30000;
            
            if (isStale) {
                offline++;
            } else if (data.speed > 5) {
                active++;
            } else {
                idle++;
            }
        } else {
            // No data received at all this session
            offline++;
        }
    });

    const activeEl = document.getElementById('countActive');
    const idleEl = document.getElementById('countIdle');
    const offlineEl = document.getElementById('countOffline');
    const allEl = document.getElementById('countAll');
    
    if(activeEl) activeEl.innerText = active;
    if(idleEl) idleEl.innerText = idle;
    if(offlineEl) offlineEl.innerText = offline;
    if(allEl) allEl.innerText = myDevices.length;
}

function closeVehiclePanel() {
    document.getElementById('vehiclePanel').classList.remove('open');
}

function focusDevice(imei) {
    activeImei = imei;
    if(markers[imei]) {
        map.flyTo(markers[imei].getLatLng(), 16, { animate: true, duration: 1.5 });
        markers[imei].openPopup();
        
        // Highlight active card in sidebar
        document.querySelectorAll('.device-card').forEach(c => {
            c.style.borderColor = 'var(--border)';
            c.style.boxShadow = 'none';
        });
        const activeCard = document.getElementById(`card-${imei}`);
        if(activeCard) {
            activeCard.style.borderColor = 'var(--primary)';
            activeCard.style.boxShadow = '0 0 15px rgba(0, 212, 255, 0.2)';
            activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        
        // Open Panel
        document.getElementById('vehiclePanel').classList.add('open');
        
        // Populate if we have data
        if(latestData[imei]) {
            const device = myDevices.find(d => d.imei === imei);
            updatePanelData(latestData[imei], device ? device.name : imei);
        }
    }
}

function updatePanelData(data, deviceName) {
    const { imei, latitude, longitude, speed, timestamp, odometer, battery, gpsValid, satellites } = data;
    
    document.getElementById('panelDeviceName').innerText = deviceName || imei;
    document.getElementById('panelSpeed').innerText = speed;
    
    // Toggle Visibility of Speedometer Gauge based on Admin settings
    const speedGauge = document.querySelector('.panel-speedometer-container');
    if (speedGauge) {
        speedGauge.style.display = isFeatureEnabled(imei, 'speedAlert') ? 'flex' : 'none';
    }
    
    // Animate Gauge (0-140 km/h mapped to 125.6-0 dashoffset)
    const maxSpeed = 140;
    const clampedSpeed = Math.min(speed, maxSpeed);
    const dashOffset = 125.6 - (125.6 * (clampedSpeed / maxSpeed));
    const speedFill = document.getElementById('speedFill');
    speedFill.style.strokeDashoffset = dashOffset;
    
    // Color code gauge based on speed
    let color = 'var(--primary)';
    if(speed > 80) color = 'var(--warning)';
    if(speed > 110) color = 'var(--danger)';
    speedFill.style.stroke = color;
    
    // Reverse Geocoding for Address
    const coordsEl = document.getElementById('panelCoords');
    coordsEl.innerText = 'Fetching address...';
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`)
        .then(res => res.json())
        .then(geo => {
            if(geo && geo.display_name) {
                const shortAddress = geo.display_name.split(',').slice(0, 3).join(', ');
                coordsEl.innerText = shortAddress;
            } else {
                coordsEl.innerText = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
            }
        })
        .catch(() => {
            coordsEl.innerText = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        });
        
    document.getElementById('panelTime').innerText = new Date(timestamp).toLocaleTimeString();
    
    if(odometer) document.getElementById('panelOdo').innerText = `${odometer.toFixed(1)} km`;
    
    // Battery & GPS
    const batteryPercentage = battery !== undefined ? battery : 98;
    const batColor = batteryPercentage < 20 ? 'var(--danger)' : 'var(--success)';
    const batIcon = batteryPercentage < 20 ? 'fa-battery-empty' : 'fa-bolt';
    document.getElementById('panelBattery').innerHTML = `${batteryPercentage}% <span style="font-size:0.6rem; color:${batColor};"><i class="fa-solid ${batIcon}"></i></span>`;
    
    const fixText = gpsValid ? '3D Fix' : 'No Fix';
    const fixColor = gpsValid ? 'var(--success)' : 'var(--danger)';
    const satCount = satellites !== undefined ? satellites : 0;
    document.getElementById('panelGps').innerHTML = `<span style="color: ${fixColor}">${fixText}</span> <span style="font-size: 0.7rem; color: var(--text-secondary);">(${satCount} Sats)</span>`;
    
    const statusEl = document.getElementById('panelStatus');
    const iconEl = document.getElementById('panelIcon');
    
    if (speed > 5) {
        statusEl.innerText = 'Running';
        statusEl.className = '';
        statusEl.style.color = 'var(--success)';
        statusEl.style.background = 'transparent';
        iconEl.className = 'telemetry-icon running';
        iconEl.innerHTML = '<i class="fa-solid fa-truck-fast"></i>';
        document.getElementById('panelIgnition').innerText = 'ON';
        document.getElementById('panelIgnition').style.color = 'var(--success)';
    } else {
        statusEl.innerText = 'Idle';
        statusEl.className = '';
        statusEl.style.color = 'var(--warning)';
        statusEl.style.background = 'transparent';
        iconEl.className = 'telemetry-icon halt';
        iconEl.innerHTML = '<i class="fa-solid fa-pause"></i>';
        document.getElementById('panelIgnition').innerText = 'OFF';
        document.getElementById('panelIgnition').style.color = 'var(--danger)';
    }

    // Toggle Visibility of stat boxes based on Admin settings
    const boxes = {
        'panelOdo': isFeatureEnabled(imei, 'odometer'),
        'panelIgnition': isFeatureEnabled(imei, 'ignitionAlert'),
        'panelBattery': isFeatureEnabled(imei, 'healthStats'),
        'panelGps': isFeatureEnabled(imei, 'healthStats')
    };

    Object.keys(boxes).forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const box = el.closest('.stat-box');
            if (box) box.style.display = boxes[id] ? 'flex' : 'none';
        }
    });
}

// Helpers for Telemetry Popup
function timeSince(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function buildTelemetryHTML(data, deviceName) {
    const { imei, latitude, longitude, speed, timestamp, odometer, battery, gpsValid, satellites } = data;
    const timeObj = new Date(timestamp);
    const batteryPercentage = battery !== undefined ? battery : 98;
    const batColor = batteryPercentage < 20 ? 'danger' : 'success';
    const batIcon = batteryPercentage < 20 ? 'fa-battery-empty' : 'fa-bolt';
    const fixText = gpsValid ? '3D Fix' : 'No Fix';
    const satCount = satellites !== undefined ? satellites : 0;
    
    let status = 'offline';
    let statusText = 'Offline';
    let iconClass = 'fa-power-off';
    
    if (speed > 0) {
        status = 'running';
        statusText = 'Running';
        iconClass = 'fa-truck-fast';
    } else if (speed === 0) {
        status = 'halt';
        statusText = 'Idle';
        iconClass = 'fa-pause';
    }
    
    return `
    <div class="telemetry-card">
        <div class="telemetry-header">
            <div class="telemetry-icon ${status}">
                <i class="fa-solid ${iconClass}"></i>
            </div>
            <div>
                <h3 class="telemetry-title" style="text-transform: uppercase; letter-spacing: 1px;">${deviceName || imei}</h3>
                <span class="telemetry-status" style="color: var(--${status === 'halt' ? 'warning' : (status === 'running' ? 'success' : 'danger')})">${statusText}</span>
            </div>
        </div>
        
        <div class="telemetry-grid">
            ${isFeatureEnabled(imei, 'speedAlert') ? `
            <div class="telemetry-item">
                <span class="telemetry-label"><i class="fa-solid fa-gauge-high"></i> Speed</span>
                <span class="telemetry-val">${speed} km/h</span>
            </div>` : ''}
            ${isFeatureEnabled(imei, 'odometer') ? `
            <div class="telemetry-item">
                <span class="telemetry-label"><i class="fa-solid fa-road"></i> Odometer</span>
                <span class="telemetry-val accent">${odometer ? odometer.toFixed(1) + ' km' : 'N/A'}</span>
            </div>` : ''}
            ${isFeatureEnabled(imei, 'healthStats') ? `
            <div class="telemetry-item">
                <span class="telemetry-label"><i class="fa-solid fa-battery-full"></i> Battery</span>
                <span class="telemetry-val">${batteryPercentage}% <span style="font-size:0.6rem; color:var(--${batColor});"><i class="fa-solid ${batIcon}"></i></span></span>
            </div>
            <div class="telemetry-item">
                <span class="telemetry-label"><i class="fa-solid fa-location-dot"></i> GPS Lock</span>
                <span class="telemetry-val" style="font-size: 0.8rem;">${fixText} (${satCount})</span>
            </div>` : ''}
        </div>
        
        <div class="telemetry-footer">
            <span><i class="fa-solid fa-signal" style="color: var(--success); margin-right: 4px;"></i> Online</span>
            <span><i class="fa-regular fa-clock"></i> ${timeSince(timeObj)}</span>
        </div>
    </div>
    `;
}

// Socket.io for live updates
const socket = io();

socket.on('subscription_expired', (data) => {
    if (data.ownerId === user.id) {
        document.getElementById('lockoutOverlay').classList.add('active');
    }
});

// Dynamic Device Data and Map Rendering Handler
function handleDeviceData(data, isLive = true) {
    if (data.ownerId != user.id) return;
    
    const { imei, latitude, longitude, speed, timestamp } = data;
    latestData[imei] = data;

    const device = myDevices.find(d => d.imei === imei);
    const deviceName = device ? device.name : imei;
    const popupHTML = buildTelemetryHTML(data, deviceName);
    
    // Check for Harsh Driving Events (only if live packet)
    const ignoredEvents = ['Location Update', 'Health Packet', 'Over the Air Command'];
    if (isLive && data.event && !ignoredEvents.includes(data.event)) {
        let type = 'info';
        if (data.event.includes('Harsh') || data.event.includes('Rash') || data.event.includes('Emergency')) {
            type = 'danger';
        } else if (data.event.includes('Tamper') || data.event.includes('Battery') || data.event.includes('Power') || data.event.includes('Disconnected') || data.event.includes('Tow') || data.event.includes('Tilt')) {
            type = 'warning';
        }
        
        const eventKey = `${imei}_${data.event}`;
        const lastEventTime = window[`last_${eventKey}`] || 0;
        const now = Date.now();
        
        let allowed = true;
        const settings = userSettings[imei] || {};
        if ((data.event.includes('Harsh') || data.event.includes('Rash')) && settings.harshAlerts === false) allowed = false;
        if (data.event.includes('Tamper') && settings.healthStats === false) allowed = false;
        if (data.event.includes('Emergency') && settings.panicAlert === false) allowed = false;
        if (data.event.includes('Ignition') && settings.ignitionAlert === false) allowed = false;
        if ((data.event.includes('Battery') || data.event.includes('Power')) && settings.healthStats === false) allowed = false;
        if (data.event.includes('Tow') && settings.towingAlert === false) allowed = false;

        if (allowed && now - lastEventTime > 10000) {
            showToast(`⚠️ Alert: ${deviceName}`, `Event Detected: ${data.event}`, type);
            window[`last_${eventKey}`] = now;
        }
    }
    
    // Update Map with Premium Custom Beacon Icon
    const status = speed > 5 ? 'running' : 'halt';
    const isPinned = device && device.pinned;
    const vehicleIcon = getVehicleIcon(data.heading, status, isPinned);

    // Live polyline breadcrumb path
    if (!livePaths[imei]) {
        livePaths[imei] = L.polyline([], {
            color: 'var(--primary)',
            weight: 3,
            opacity: 0.6,
            dashArray: '5, 5'
        }).addTo(map);
    }
    
    const latlngs = livePaths[imei].getLatLngs();
    latlngs.push([latitude, longitude]);
    if (latlngs.length > 100) latlngs.shift();
    livePaths[imei].setLatLngs(latlngs);

    if(markers[imei]) {
        markers[imei].setLatLng([latitude, longitude]);
        markers[imei].setIcon(vehicleIcon);
        if(markers[imei].isPopupOpen()) {
            markers[imei].getPopup().setContent(popupHTML);
        } else {
            markers[imei].setPopupContent(popupHTML);
        }
    } else {
        markers[imei] = L.marker([latitude, longitude], { icon: vehicleIcon }).addTo(map)
            .bindPopup(popupHTML)
            .on('click', () => focusDevice(imei));
    }
    
    // Auto-focus logic: Focus the pinned vehicle by default
    if (isLive) {
        if (device && device.pinned && !window.initialFocusDone) {
            window.initialFocusDone = true;
            focusDevice(imei);
        } else if (!window.initialFocusDone && myDevices.every(d => !d.pinned)) {
            window.initialFocusDone = true;
            focusDevice(imei);
        }
    }
    
    // Update Sidebar elements
    const speedEl = document.getElementById(`speed-${imei}`);
    const timeEl = document.getElementById(`time-${imei}`);
    const statusEl = document.getElementById(`status-${imei}`);
    const odoEl = document.getElementById(`odo-${imei}`);
    
    if(speedEl) {
        speedEl.innerText = speed;
        if(odoEl && data.odometer) odoEl.innerText = data.odometer.toFixed(1);
        
        const timeObj = new Date(timestamp);
        timeEl.innerText = timeObj.toLocaleTimeString();
        
        statusEl.innerText = speed > 5 ? 'Running' : 'Idle';
        statusEl.className = '';
        statusEl.style.color = speed > 5 ? 'var(--success)' : 'var(--warning)';
        statusEl.style.background = 'transparent';
    }
    
    // Update panel if it's currently open for this device
    const panel = document.getElementById('vehiclePanel');
    if(panel.classList.contains('open') && activeImei === imei) {
        updatePanelData(data, deviceName);
    }
    
    updateFleetCounts();
}

// Generate premium custom rotating arrowhead marker icon
function getVehicleIcon(heading, status, pinned) {
    let color = '#FFab00'; // Idle (Amber)
    let pulseClass = '';
    if (status === 'running') {
        color = '#00E676'; // Moving (Green)
        pulseClass = 'beacon-pulse';
    } else if (status === 'offline') {
        color = '#FF3D00'; // Offline (Red)
    }
    
    const borderStyle = pinned ? 'border: 2px dashed #FFb547;' : 'border: 1.5px solid rgba(255, 255, 255, 0.4);';
    const shadowStyle = pinned ? 'box-shadow: 0 0 12px #FFb547;' : `box-shadow: 0 0 8px ${color};`;

    return L.divIcon({
        className: 'custom-vehicle-marker',
        html: `
            <div class="vehicle-beacon ${pulseClass}" style="background: ${color}; color: ${color}; ${borderStyle} ${shadowStyle}">
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

socket.on('panic_alert', (data) => {
    const settings = userSettings[data.imei] || {};
    if (data.ownerId === user.id && settings.panicAlert !== false) {
        showPanicAlert(data);
    }
});

socket.on('settings_updated', (data) => {
    if (data.userId === user.id) {
        const { imei, settings } = data;
        console.log(`[Socket] Settings Updated for ${imei}:`, settings);
        userSettings[imei] = settings;
        showToast("⚙️ Configuration Updated", `Device ${imei} settings updated by Admin.`, "info");
        
        renderDeviceList(); // Refresh sidebar visibility
        
        // Refresh Geofence button visibility
        const anyGeofenceEnabled = myDevices.some(d => isFeatureEnabled(d.imei, 'geofenceAlert'));
        const geofenceBtn = document.getElementById('geofenceToggleBtn');
        if (geofenceBtn) geofenceBtn.style.display = anyGeofenceEnabled ? 'block' : 'none';

        // Update popup HTML content of existing marker
        if (markers[imei] && latestData[imei]) {
            const device = myDevices.find(d => d.imei === imei);
            const popupHTML = buildTelemetryHTML(latestData[imei], device ? device.name : imei);
            markers[imei].setPopupContent(popupHTML);
        }

        // Re-render current panel if open and it's this device
        if(activeImei === imei && latestData[imei]) {
            const device = myDevices.find(d => d.imei === imei);
            updatePanelData(latestData[imei], device ? device.name : imei);
        }
    }
});

socket.on('geofence_alert', (data) => {
    const settings = userSettings[data.imei] || {};
    if (data.ownerId !== user.id || settings.geofenceAlert === false) return;
    
    const isEnter = data.type === 'geofence_enter';
    const title = `🚨 Geofence Alert: ${data.deviceName}`;
    const msg = `Vehicle has ${isEnter ? 'ENTERED' : 'EXITED'} geofence: ${data.geofenceName}`;
    const alertType = isEnter ? 'info' : 'warning';
    
    const eventKey = `${data.imei}_${data.type}_${data.geofenceName}`;
    const lastEventTime = window[`last_${eventKey}`] || 0;
    const now = Date.now();
    if (now - lastEventTime > 30000) {
        showToast(title, msg, alertType);
        window[`last_${eventKey}`] = now;
    }
});

socket.on('device_data', (data) => {
    handleDeviceData(data, true);
});

initMap();
loadData();

// ==========================================
// History Playback Logic
// ==========================================
let historyPolyline = null;
let historyMarker = null;
let historyData = [];
let playbackInterval = null;
let playbackIndex = 0;
let isPlaying = false;

async function startHistoryMode() {
    if(!activeImei) return alert('Please select a vehicle first.');
    
    // UI Changes
    document.querySelector('.bottom-filter').style.display = 'none';
    document.getElementById('playbackControls').style.display = 'flex';
    document.getElementById('vehiclePanel').classList.remove('open');
    document.querySelector('.sidebar-wrapper').style.transform = 'translateX(-110%)'; // Hide sidebar
    
    // Fetch History
    try {
        const res = await fetch(`/api/customer/history?imei=${activeImei}`);
        const data = await res.json();
        historyData = data.history;
        
        if(!historyData || historyData.length === 0) {
            alert('No history data available for this vehicle yet.');
            exitHistoryMode();
            return;
        }
        
        // Draw Polyline
        const latlngs = historyData.map(p => [p.latitude, p.longitude]);
        if(historyPolyline) map.removeLayer(historyPolyline);
        historyPolyline = L.polyline(latlngs, {color: 'var(--primary)', weight: 4, opacity: 0.8}).addTo(map);
        map.fitBounds(historyPolyline.getBounds());
        
        // Setup Marker
        if(historyMarker) map.removeLayer(historyMarker);
        const firstPt = historyData[0];
        historyMarker = L.marker([firstPt.latitude, firstPt.longitude], {
            icon: L.divIcon({
                className: 'history-marker',
                html: '<div style="width:16px;height:16px;background:var(--accent);border-radius:50%;border:3px solid #fff;box-shadow:0 0 10px rgba(255,115,0,0.8);"></div>',
                iconSize: [16, 16], iconAnchor: [8, 8]
            }),
            zIndexOffset: 1000
        }).addTo(map);
        
        // Init Slider
        document.getElementById('pbSlider').max = historyData.length - 1;
        document.getElementById('pbSlider').value = 0;
        updatePlaybackUI(0);
        
    } catch(e) {
        console.error('Error loading history:', e);
        exitHistoryMode();
    }
}

function updatePlaybackUI(index) {
    if(!historyData || !historyData[index]) return;
    const pt = historyData[index];
    
    historyMarker.setLatLng([pt.latitude, pt.longitude]);
    document.getElementById('pbTime').innerText = new Date(pt.timestamp).toLocaleTimeString();
    document.getElementById('pbSpeed').innerText = `${pt.speed} km/h`;
}

function togglePlayback() {
    isPlaying = !isPlaying;
    const btn = document.getElementById('playBtn');
    
    if(isPlaying) {
        btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
        if(playbackIndex >= historyData.length - 1) playbackIndex = 0; // restart
        
        playbackInterval = setInterval(() => {
            playbackIndex++;
            if(playbackIndex >= historyData.length) {
                togglePlayback(); // pause at end
                playbackIndex = historyData.length - 1;
            } else {
                document.getElementById('pbSlider').value = playbackIndex;
                updatePlaybackUI(playbackIndex);
            }
        }, 100); // 100ms per point
    } else {
        btn.innerHTML = '<i class="fa-solid fa-play"></i>';
        clearInterval(playbackInterval);
    }
}

function seekPlayback(val) {
    playbackIndex = parseInt(val);
    updatePlaybackUI(playbackIndex);
}

function exitHistoryMode() {
    isPlaying = false;
    clearInterval(playbackInterval);
    document.getElementById('playBtn').innerHTML = '<i class="fa-solid fa-play"></i>';
    
    if(historyPolyline) map.removeLayer(historyPolyline);
    if(historyMarker) map.removeLayer(historyMarker);
    
    document.querySelector('.bottom-filter').style.display = 'flex';
    document.getElementById('playbackControls').style.display = 'none';
    document.querySelector('.sidebar-wrapper').style.transform = ''; // Show sidebar
    
    if(activeImei) focusDevice(activeImei); // Return to live view
}
