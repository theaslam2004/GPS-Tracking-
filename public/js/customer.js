// Global Error Catcher for Debugging
window.onerror = function(message, source, lineno, colno, error) {
    console.error('GLOBAL ERROR:', message, 'at', source, ':', lineno);
    if(typeof showToast === 'function') {
        showToast("🚨 System Error", `${message} (Line: ${lineno})`, "danger");
    }
    return false;
};

let user = null;

// Perform startup authentication validation check
(async () => {
    // Request desktop notification permission on startup
    if (typeof Notification !== 'undefined') {
        if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
            Notification.requestPermission();
        }
    }
    
    try {
        const response = await fetch('/api/auth/me');
        if (response.status === 401) {
            console.warn('[Auth Check] Unauthorized: Redirecting to login...');
            localStorage.removeItem('user');
            window.location.href = 'index.html';
            return;
        }
        const data = await response.json();
        if (!data.success || !data.user || data.user.role !== 'customer') {
            console.warn('[Auth Check] Access Denied or Session Stale. Redirecting to login...');
            localStorage.removeItem('user');
            window.location.href = 'index.html';
            return;
        }
        
        // Sync user object
        user = data.user;
        localStorage.setItem('user', JSON.stringify(user));
        
        // Setup Export link
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) {
            exportBtn.href = `/api/export/devices?userId=${user.id}&role=${user.role}`;
        }
        
        // Initialize Map and Load Data
        initMap();
        loadData();

        // Default history date input to today
        const dateInput = document.getElementById('pbDateInput');
        if (dateInput) {
            dateInput.value = new Date().toLocaleDateString('en-CA');
            dateInput.addEventListener('change', () => {
                if (activeImei) {
                    startHistoryMode();
                }
            });
        }
    } catch (e) {
        console.error('[Auth Check] Error validating session:', e);
        localStorage.removeItem('user');
        window.location.href = 'index.html';
    }
})();

let map;
const markers = {};
const livePaths = {}; // Store L.polyline paths for breadcrumbs
let myDevices = [];
let latestData = {}; // Store latest telemetry for panel
let activeImei = null;
let userSettings = {};
let currentFilter = 'all';

window.applyFilter = function(type) {
    currentFilter = type;
    renderDeviceList();
};

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
    standard: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap &copy; CARTO' }),
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
    if (currentLayerName === 'standard') currentLayerName = 'satellite';
    else currentLayerName = 'standard';
    mapLayers[currentLayerName].addTo(map);
}

function logout() {
    localStorage.removeItem('user');
    window.location.href = 'index.html';
}

async function loadTrackerConfig() {
    try {
        const res = await fetch('/api/tracker-config');
        const config = await res.json();
        document.getElementById('cfgIp').innerText = config.ip || 'acela.proxy.rlwy.net';
        document.getElementById('cfgIpAddress').innerText = config.ipAddress || '66.33.22.226';
        document.getElementById('cfgPort').innerText = config.port || '24706';
    } catch (err) {
        console.error('Failed to load tracker config:', err);
        document.getElementById('cfgIp').innerText = 'acela.proxy.rlwy.net';
        document.getElementById('cfgIpAddress').innerText = '66.33.22.226';
        document.getElementById('cfgPort').innerText = '24706';
    }
}

function showAddDeviceModal() {
    loadTrackerConfig();
    document.getElementById('addDeviceModal').classList.add('active');
}

function closeAddDeviceModal() { document.getElementById('addDeviceModal').classList.remove('active'); }

function showUpgradeModal() {
    const pricing = window.pricingConfig;
    const currentPlan = window.currentPlanName || 'Trial';
    const container = document.getElementById('customerUpgradePlansContainer');
    if (!container || !pricing) return;
    
    // Sort plans by price
    const sortedPlanKeys = Object.keys(pricing).sort((a,b) => pricing[a].price - pricing[b].price);
    
    container.innerHTML = sortedPlanKeys.map(key => {
        const plan = pricing[key];
        if (plan.name === 'Trial') return ''; // Don't show trial as upgrade option
        
        const isCurrent = currentPlan === plan.name;
        const activeClass = isCurrent ? 'style="border-color: var(--accent); box-shadow: 0 0 15px rgba(0,220,180,0.25);"' : '';
        const limitText = plan.deviceLimit >= 500 ? 'Unlimited' : `${plan.deviceLimit} Device(s)`;
        
        return `
            <div class="plan-card glass-panel" ${activeClass} style="display: flex; flex-direction: column; justify-content: space-between; padding: 1.5rem; border: 1px solid var(--border-light); border-radius: var(--radius-md); transition: all 0.2s; position: relative;">
                ${isCurrent ? '<div style="position: absolute; top: -10px; right: 10px; background: var(--accent); color: #000; font-size: 0.65rem; font-weight: 800; padding: 2px 8px; border-radius: 10px; text-transform: uppercase;">Current</div>' : ''}
                <div>
                    <h3 style="font-family: \'Outfit\', sans-serif; font-size: 1.25rem; font-weight: 700; margin-bottom: 0.5rem; color: ${isCurrent ? 'var(--accent)' : 'var(--text-primary)'};">${plan.name}</h3>
                    <div style="font-family: \'Outfit\', sans-serif; font-size: 1.8rem; font-weight: 800; color: #fff; margin-bottom: 1rem;">
                        ₹${plan.price}<span style="font-size: 0.85rem; font-weight: 400; color: var(--text-secondary);">/mo</span>
                    </div>
                    <ul style="list-style: none; padding: 0; font-size: 0.82rem; color: var(--text-secondary); display: flex; flex-direction: column; gap: 8px; margin-bottom: 1.5rem;">
                        <li><i class="fa-solid fa-check" style="color: var(--accent); margin-right: 6px;"></i> Support for <b>${limitText}</b></li>
                        <li><i class="fa-solid fa-check" style="color: var(--accent); margin-right: 6px;"></i> <b>${plan.validityDays} Days</b> validity</li>
                        <li><i class="fa-solid fa-check" style="color: var(--accent); margin-right: 6px;"></i> Simulated checkout in INR</li>
                    </ul>
                </div>
                <button class="btn ${isCurrent ? 'btn-outline' : 'btn-primary'}" onclick="upgradePlan('${plan.name}')" ${isCurrent ? 'disabled' : ''} style="width: 100%; font-size: 0.82rem; padding: 0.6rem;">
                    ${isCurrent ? 'Active Plan' : 'Choose Plan'}
                </button>
            </div>
        `;
    }).join('');

    document.getElementById('upgradeModal').classList.add('active');
}

function closeUpgradeModal() {
    document.getElementById('upgradeModal').classList.remove('active');
}

async function upgradePlan(planName) {
    if (!confirm(`Upgrade to the ${planName} Plan? (Simulated payment will be completed)`)) return;
    
    try {
        const res = await fetch('/api/customer/upgrade-plan', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ userId: user.id, planName })
        });
        const data = await res.json();
        if (data.success) {
            closeUpgradeModal();
            showToast("🎉 Subscription Active", `You are now on the ${planName} Plan!`, "success");
            setTimeout(() => window.location.reload(), 1500);
        } else {
            showToast("❌ Upgrade Failed", data.error || 'Server rejected request.', "danger");
        }
    } catch (e) {
        showToast("❌ Connection Error", "Failed to contact billing server.", "danger");
    }
}

function showPanicAlert(data) {
    const modal = document.getElementById('panicModal');
    const msg = document.getElementById('panicMessage');
    const trackBtn = document.getElementById('panicTrackBtn');
    
    const devName = data.deviceName || data.imei || 'Vehicle';
    
    msg.innerHTML = `Emergency signal received from <b>${devName}</b>.<br>Time: ${new Date(data.time).toLocaleTimeString()}`;
    document.body.classList.add('panic-active');
    modal.classList.add('active');
    
    // Play alert sound
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/951/951-preview.mp3');
    audio.play().catch(e => console.warn('Audio playback blocked by browser'));

    // Trigger Native HTML5 Desktop Notification
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(`🚨 PANIC ALERT: ${devName}`, {
            body: `Emergency button pressed! Location: ${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`,
            requireInteraction: true
        });
    }

    // Trigger danger-styled toast next to the panic modal
    showToast(`🚨 Emergency Alert: ${devName}`, `Emergency button has been pressed!`, 'danger');

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
    const imeiField = document.getElementById('newImei');
    const imei = imeiField ? imeiField.value.trim() : '';
    if(!imei) return showToast("⚠️ Warning", 'Enter IMEI', "warning");
    
    try {
        const res = await fetch('/api/customer/request-device', {
            method: 'POST',
            headers:{'Content-Type': 'application/json'},
            body: JSON.stringify({ userId: user.id, imei })
        });
        const data = await res.json();
        if(data.success) {
            showToast("✉️ Request Sent", "Your request to link this tracker has been submitted to the admin for approval.", "info");
            closeAddDeviceModal();
            if (imeiField) imeiField.value = '';
            loadData();
        } else {
            showToast("❌ Error", data.error || "Failed to add device.", "danger");
        }
    } catch (e) {
        showToast("❌ Error", "Connection failed.", "danger");
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
            
            // Set plan details and device limits
            document.getElementById('activePlanName').innerText = data.subscription.planName || 'Trial';
            document.getElementById('deviceUsage').innerText = `${data.deviceCount} / ${data.subscription.deviceLimit || 1}`;
            window.pricingConfig = data.pricing;
            window.currentPlanName = data.subscription.planName || 'Trial';
            
            if(daysLeft <= 0) {
                const subBanner = document.getElementById('subBanner');
                if (subBanner) subBanner.style.background = '#fee2e2';
                const lockoutOverlay = document.getElementById('lockoutOverlay');
                if (lockoutOverlay) lockoutOverlay.classList.add('active');
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
        const geofenceMenu = document.getElementById('menu-item-geofence');
        const controlsContainer = document.getElementById('sidebarControlsContainer');
        if (geofenceBtn) {
            geofenceBtn.style.setProperty('display', anyGeofenceEnabled ? 'block' : 'none', 'important');
        }
        if (geofenceMenu) {
            geofenceMenu.style.setProperty('display', anyGeofenceEnabled ? 'flex' : 'none', 'important');
        }
        if (controlsContainer) {
            controlsContainer.style.display = anyGeofenceEnabled ? 'block' : 'none';
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

    const filteredDevices = sortedDevices.filter(d => {
        if (currentFilter === 'all') return true;
        const live = latestData[d.imei] || {};
        const isStale = live.timestamp ? (Date.now() - new Date(live.timestamp)) > 60000 : true;
        let statusText = 'offline';
        if (live.timestamp && !isStale) {
            statusText = live.status || 'halt';
        }
        
        if (currentFilter === 'running') {
            return statusText === 'running';
        }
        if (currentFilter === 'idle') {
            return statusText === 'idle';
        }
        if (currentFilter === 'halt') {
            return statusText === 'halt';
        }
        if (currentFilter === 'offline') {
            return statusText === 'offline';
        }
        return true;
    });
    
    container.innerHTML = filteredDevices.map(d => {
        const odoHidden = !isFeatureEnabled(d.imei, 'odometer') ? 'display:none' : '';
        const speedHidden = !isFeatureEnabled(d.imei, 'speedAlert') ? 'display:none' : '';
        
        // Use live telemetry values if available
        const live = latestData[d.imei] || {};
        const speedVal = live.speed !== undefined ? live.speed : 0;
        const isOdoVerified = (live.odometer !== undefined && live.odometer > 0);
        const odoVal = isOdoVerified ? live.odometer.toFixed(1) : '--';
        const timeVal = live.timestamp ? new Date(live.timestamp).toLocaleTimeString() : '--';
        
        // Offline status check
        let statusText = 'Offline';
        let statusColor = 'var(--text-secondary)';
        if (live.timestamp) {
            const isStale = (Date.now() - new Date(live.timestamp)) > 60000;
            if (!isStale) {
                const s = live.status || 'halt';
                if (s === 'running') {
                    statusText = 'Running';
                    statusColor = 'var(--success)';
                } else if (s === 'idle') {
                    statusText = 'Idle';
                    statusColor = 'var(--warning)';
                } else {
                    statusText = 'Halt';
                    statusColor = 'var(--danger)';
                }
            }
        }
        
        const isSecondary = (live.powerSource === 'secondary');
        const batAlert = isSecondary ? `<i class="fa-solid fa-triangle-exclamation" style="color: var(--danger); margin-left: 6px; animation: pulseGlow 1.5s infinite ease-in-out;" title="Warning: Running on Backup Battery!"></i>` : '';
        const activeClass = (d.imei === activeImei) ? 'active' : '';

        return `
            <div class="device-card ${activeClass}" id="card-${d.imei}" onclick="focusDevice('${d.imei}')">
                <div class="device-header" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div class="device-title" style="display: flex; align-items: center; gap: 6px; font-size: 0.9rem; font-weight: 700; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 70%;">
                        <i class="fa-solid fa-star" style="color: ${d.pinned ? 'var(--warning)' : 'var(--text-secondary)'}; opacity: ${d.pinned ? '1' : '0.5'}; cursor: pointer; transition: all 0.2s;" onclick="togglePin('${d.imei}', event)" title="${d.pinned ? 'Unpin' : 'Pin to top'}"></i>
                        <i class="fa-solid fa-truck" style="font-size: 0.85rem; flex-shrink: 0;"></i>
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700;" title="${d.name || d.imei}">${d.name || d.imei}</span>
                        ${batAlert}
                        <i class="fa-solid fa-pen-to-square rename-btn" style="cursor: pointer; opacity: 0.5; font-size: 0.75rem; flex-shrink: 0;" onclick="renameDevicePrompt('${d.imei}', '${d.name || ''}', event)" title="Rename vehicle"></i>
                    </div>
                    <div style="font-weight: 700; font-size: 0.75rem; color: ${statusColor}; white-space: nowrap; flex-shrink: 0;" id="status-${d.imei}">${statusText}</div>
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
    if (typeof filterVehicleList === 'function') filterVehicleList();
}

function updateFleetCounts() {
    let active = 0;
    let idle = 0;
    let halt = 0;
    let offline = 0;
    
    // Scan all devices for current status
    myDevices.forEach(device => {
        const data = latestData[device.imei];
        if (data) {
            // Check if data is "Fresh" (within last 60 seconds)
            const isStale = (Date.now() - new Date(data.timestamp)) > 60000;
            
            if (isStale) {
                offline++;
            } else {
                const s = data.status || 'halt';
                if (s === 'running') {
                    active++;
                } else if (s === 'idle') {
                    idle++;
                } else {
                    halt++;
                }
            }
        } else {
            // No data received at all this session
            offline++;
        }
    });

    const activeEl = document.getElementById('countActive');
    const idleEl = document.getElementById('countIdle');
    const haltEl = document.getElementById('countHalt');
    const offlineEl = document.getElementById('countOffline');
    const allEl = document.getElementById('countAll');
    
    if(activeEl) activeEl.innerText = active;
    if(idleEl) idleEl.innerText = idle;
    if(haltEl) haltEl.innerText = halt;
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
        
        // Highlight active card by re-rendering list
        renderDeviceList();
        
        const activeCard = document.getElementById(`card-${imei}`);
        if(activeCard) {
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
    const isStale = (Date.now() - new Date(timestamp)) > 60000;
    
    const device = myDevices.find(d => d.imei === imei);
    
    document.getElementById('panelDeviceName').innerText = deviceName || imei;
    document.getElementById('panelSpeed').innerText = speed;
    
    // Populate config fields
    const driverInput = document.getElementById('cfgDriverName');
    const profileSelect = document.getElementById('cfgVehicleProfile');
    const odoInput = document.getElementById('cfgInitialOdometer');
    
    if (driverInput && device) driverInput.value = device.driverName || 'Unassigned';
    if (profileSelect && device) profileSelect.value = device.vehicleProfile || 'standard';
    if (odoInput && device) odoInput.value = device.initialOdometer || 0;
    
    // Voltage profile verification
    const profile = device ? device.vehicleProfile || 'standard' : 'standard';
    const volt = data.voltage !== undefined ? data.voltage : 12.0;
    let voltStatus = 'Normal';
    let voltColor = 'var(--success)';
    
    if (profile === 'heavy') {
        if (volt < 42.0) {
            voltStatus = 'Low Voltage';
            voltColor = 'var(--danger)';
        } else if (volt > 56.0) {
            voltStatus = 'Overvoltage';
            voltColor = 'var(--warning)';
        }
    } else {
        if (volt < 11.0 || (volt > 15.0 && volt < 22.0)) {
            voltStatus = 'Low Voltage';
            voltColor = 'var(--danger)';
        } else if (volt > 30.0) {
            voltStatus = 'Overvoltage';
            voltColor = 'var(--warning)';
        }
    }
    const panelVoltEl = document.getElementById('panelVoltage');
    if (panelVoltEl) {
        panelVoltEl.innerHTML = `${volt.toFixed(1)} V <span style="font-size: 0.72rem; color: ${voltColor}; font-weight: 700;">(${voltStatus})</span>`;
    }
    
    // Backup battery warning
    const warningEl = document.getElementById('backupBatteryWarning');
    const isSecondaryMode = (data.powerSource === 'secondary');
    if (warningEl) {
        warningEl.style.display = isSecondaryMode ? 'block' : 'none';
    }

    // Toggle check lights in panel header
    const checkLightEl = document.getElementById('panelCheckLight');
    const normalLightEl = document.getElementById('panelNormalLight');
    if (checkLightEl && normalLightEl) {
        if (isSecondaryMode) {
            checkLightEl.style.display = 'inline-flex';
            normalLightEl.style.display = 'none';
        } else {
            checkLightEl.style.display = 'none';
            normalLightEl.style.display = 'inline-flex';
        }
    }
    
    // Toggle Visibility of Speedometer Gauge based on Admin settings and device status (hide on halt/offline)
    const currentStatus = isStale ? 'offline' : (data.status || 'halt');
    const speedGauge = document.querySelector('.panel-speedometer-container');
    if (speedGauge) {
        const isAlertEnabled = isFeatureEnabled(imei, 'speedAlert');
        const shouldShowSpeed = isAlertEnabled && currentStatus !== 'halt' && currentStatus !== 'offline';
        speedGauge.style.display = shouldShowSpeed ? 'flex' : 'none';
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
    fetch(`/api/geocode?lat=${latitude}&lon=${longitude}`)
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
    
    const odoEl = document.getElementById('panelOdo');
    if (odoEl) {
        const isOdoVerified = (odometer !== undefined && odometer > 0);
        odoEl.innerText = isOdoVerified ? `${odometer.toFixed(1)} km` : '--';
    }
    
    // Voltage & GPS
    const isSecondary = (data.powerSource === 'secondary');
    const batColor = isSecondary ? 'var(--danger)' : 'var(--success)';
    const batIcon = isSecondary ? 'fa-car-battery' : 'fa-bolt';
    const batText = isSecondary ? 'Backup Battery (Warning)' : 'Primary Battery (Normal)';
    const voltVal = data.voltage !== undefined ? data.voltage.toFixed(1) : '12.0';
    document.getElementById('panelBattery').innerHTML = `${voltVal} V <span style="font-size:0.68rem; color:${batColor}; font-weight:700;"><i class="fa-solid ${batIcon}"></i> ${batText}</span>`;
    
    const fixText = gpsValid ? '3D Fix' : 'No Fix';
    const fixColor = gpsValid ? 'var(--success)' : 'var(--danger)';
    const satCount = satellites !== undefined ? satellites : 0;
    document.getElementById('panelGps').innerHTML = `<span style="color: ${fixColor}">${fixText}</span> <span style="font-size: 0.7rem; color: var(--text-secondary);">(${satCount} Sats)</span>`;
    
    const statusEl = document.getElementById('panelStatus');
    const iconEl = document.getElementById('panelIcon');
    
    if (isStale) {
        statusEl.innerText = 'Offline';
        statusEl.style.color = 'var(--text-secondary)';
        iconEl.className = 'telemetry-icon offline';
        iconEl.innerHTML = '<i class="fa-solid fa-power-off"></i>';
    } else {
        const s = data.status || 'halt';
        if (s === 'running') {
            statusEl.innerText = 'Running';
            statusEl.style.color = 'var(--success)';
            iconEl.className = 'telemetry-icon running';
            iconEl.innerHTML = '<i class="fa-solid fa-truck-fast"></i>';
        } else if (s === 'idle') {
            statusEl.innerText = 'Idle';
            statusEl.style.color = 'var(--warning)';
            iconEl.className = 'telemetry-icon idle';
            iconEl.innerHTML = '<i class="fa-solid fa-pause"></i>';
        } else {
            statusEl.innerText = 'Halt';
            statusEl.style.color = 'var(--danger)';
            iconEl.className = 'telemetry-icon halt';
            iconEl.innerHTML = '<i class="fa-solid fa-hand"></i>';
        }
    }

    if (data.ignition === true) {
        document.getElementById('panelIgnition').innerText = 'ON';
        document.getElementById('panelIgnition').style.color = 'var(--success)';
    } else {
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

    const deviceExportBtn = document.getElementById('deviceExportBtn');
    if (deviceExportBtn) {
        if (isFeatureEnabled(imei, 'csvExport')) {
            deviceExportBtn.style.display = 'flex';
            deviceExportBtn.href = `/api/export/history/${imei}`;
        } else {
            deviceExportBtn.style.display = 'none';
        }
    }
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
    const { imei, latitude, longitude, speed, timestamp, odometer, battery, gpsValid, satellites, voltage, powerSource } = data;
    const timeObj = new Date(timestamp);
    const isSecondary = (powerSource === 'secondary');
    const batColor = isSecondary ? 'danger' : 'success';
    const batIcon = isSecondary ? 'fa-car-battery' : 'fa-bolt';
    const voltVal = voltage !== undefined ? voltage.toFixed(1) : '12.0';
    const fixText = gpsValid ? '3D Fix' : 'No Fix';
    const satCount = satellites !== undefined ? satellites : 0;
    
    const isStale = (Date.now() - new Date(timestamp)) > 60000;
    let status = 'offline';
    let statusText = 'Offline';
    let iconClass = 'fa-power-off';
    let statusColorVar = 'text-secondary';
    
    if (!isStale) {
        status = data.status || 'halt';
        if (status === 'running') {
            statusText = 'Running';
            iconClass = 'fa-truck-fast';
            statusColorVar = 'success';
        } else if (status === 'idle') {
            statusText = 'Idle';
            iconClass = 'fa-pause';
            statusColorVar = 'warning';
        } else {
            status = 'halt';
            statusText = 'Halt';
            iconClass = 'fa-hand';
            statusColorVar = 'danger';
        }
    }
    
    return `
    <div class="telemetry-card">
        <div class="telemetry-header">
            <div class="telemetry-icon ${status}">
                <i class="fa-solid ${iconClass}"></i>
            </div>
            <div>
                <h3 class="telemetry-title" style="text-transform: uppercase; letter-spacing: 1px;">${deviceName || imei}</h3>
                <span class="telemetry-status" style="color: var(--${statusColorVar})">${statusText}</span>
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
                <span class="telemetry-label"><i class="fa-solid fa-car-battery"></i> Voltage</span>
                <span class="telemetry-val">${voltVal} V <span style="font-size:0.6rem; color:var(--${batColor});"><i class="fa-solid ${batIcon}"></i></span></span>
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
        const lockoutOverlay = document.getElementById('lockoutOverlay');
        if (lockoutOverlay) lockoutOverlay.classList.add('active');
    }
});

// Auto-refresh when customer details or device approvals are modified by admin
socket.on('customer_update', (data) => {
    if (data.userId === user.id) {
        console.log('[Socket] Customer profile updated, reloading dashboard data.');
        loadData();
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
    const isStale = (Date.now() - new Date(timestamp)) > 60000;
    const beaconStatus = isStale ? 'offline' : (data.status || 'halt');
    const isPinned = device && device.pinned;
    const vehicleIcon = getVehicleIcon(data.heading, beaconStatus, isPinned);


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
    
    // Update Sidebar card list & status counts
    renderDeviceList();
    
    // Update panel if it's currently open for this device
    const panel = document.getElementById('vehiclePanel');
    if(panel.classList.contains('open') && activeImei === imei) {
        updatePanelData(data, deviceName);
    }
}

// Generate premium custom rotating arrowhead marker icon
function getVehicleIcon(heading, status, pinned) {
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
        if (geofenceBtn) geofenceBtn.style.setProperty('display', anyGeofenceEnabled ? 'block' : 'none', 'important');
        const geofenceMenu = document.getElementById('menu-item-geofence');
        if (geofenceMenu) geofenceMenu.style.setProperty('display', anyGeofenceEnabled ? 'flex' : 'none', 'important');
        const controlsContainer = document.getElementById('sidebarControlsContainer');
        if (controlsContainer) {
            controlsContainer.style.display = anyGeofenceEnabled ? 'block' : 'none';
        }

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
    if(!activeImei) return;
    
    // UI Changes
    document.querySelector('.bottom-filter').style.display = 'none';
    document.getElementById('playbackControls').style.display = 'flex';
    document.getElementById('vehiclePanel').classList.remove('open');
    
    // Keep sidebar open, select the Replay tab
    const tabLive = document.getElementById('tabLive');
    const tabReplay = document.getElementById('tabReplay');
    if (tabLive && tabReplay) {
        tabLive.classList.remove('active');
        tabReplay.classList.add('active');
    }
    
    // Get selected date
    const dateInput = document.getElementById('pbDateInput');
    if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toLocaleDateString('en-CA');
    }
    const selectedDate = dateInput ? dateInput.value : '';

    // Fetch History
    try {
        const res = await fetch(`/api/customer/history?imei=${activeImei}&date=${selectedDate}`);
        const data = await res.json();
        historyData = data.history;
        
        if(!historyData || historyData.length === 0) {
            showToast("ℹ️ No History Data", "No tracking points found for the selected date.", "warning");
            // Clear map layers
            if(historyPolyline) { map.removeLayer(historyPolyline); historyPolyline = null; }
            if(historyMarker) { map.removeLayer(historyMarker); historyMarker = null; }
            // Reset slider and labels
            document.getElementById('pbSlider').value = 0;
            document.getElementById('pbSlider').max = 0;
            document.getElementById('pbTime').innerText = "--/--/---- --:--:--";
            document.getElementById('pbSpeed').innerText = "0 km/h";
            return;
        }
        
        // Draw Polyline (Filtering out invalid 0,0 coordinates)
        const latlngs = historyData
            .filter(p => p.latitude && p.longitude && p.latitude !== 0 && p.longitude !== 0)
            .map(p => [p.latitude, p.longitude]);
        if(historyPolyline) map.removeLayer(historyPolyline);
        if (latlngs.length > 0) {
            historyPolyline = L.polyline(latlngs, {color: 'var(--primary)', weight: 4, opacity: 0.8}).addTo(map);
            map.fitBounds(historyPolyline.getBounds());
        } else {
            console.warn('[History] No valid coordinates to render history polyline.');
        }
        
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
    
    if (historyMarker) historyMarker.setLatLng([pt.latitude, pt.longitude]);
    
    // Format full date & time (locale dependent but nice)
    const timeObj = new Date(pt.timestamp);
    const datePart = timeObj.toLocaleDateString('en-GB'); // DD/MM/YYYY
    const timePart = timeObj.toLocaleTimeString('en-GB'); // HH:MM:SS
    document.getElementById('pbTime').innerText = `${datePart} ${timePart}`;
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
    
    // Keep sidebar open, select the Live tab
    const tabLive = document.getElementById('tabLive');
    const tabReplay = document.getElementById('tabReplay');
    if (tabLive && tabReplay) {
        tabLive.classList.add('active');
        tabReplay.classList.remove('active');
    }
    
    if(activeImei) focusDevice(activeImei); // Return to live view
}

// ── CUSTOM FUNCTIONS FOR ASSET / DRIVER MANAGEMENT ──

async function renameDevicePrompt(imei, currentName, event) {
    if (event) event.stopPropagation();
    const newName = prompt("Enter new name for vehicle:", currentName);
    if (newName === null) return; // cancelled
    
    try {
        const res = await fetch('/api/customer/rename-device', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ userId: user.id, imei, name: newName.trim() })
        });
        const data = await res.json();
        if (data.success) {
            showToast("✅ Renamed", "Vehicle renamed successfully.", "success");
            // update local device array
            const dev = myDevices.find(d => d.imei === imei);
            if (dev) dev.name = newName.trim();
            renderDeviceList();
            
            // if this is the active device, update the panel title too
            if (activeImei === imei) {
                document.getElementById('panelDeviceName').innerText = newName.trim() || imei;
            }
        } else {
            showToast("❌ Error", "Failed to rename vehicle.", "danger");
        }
    } catch(e) {
        showToast("❌ Error", "Network error while renaming.", "danger");
    }
}

async function saveVehicleConfig() {
    if (!activeImei) return;
    
    const driverName = document.getElementById('cfgDriverName').value.trim();
    const vehicleProfile = document.getElementById('cfgVehicleProfile').value;
    const initialOdometer = parseFloat(document.getElementById('cfgInitialOdometer').value || 0);
    
    try {
        const res = await fetch('/api/customer/update-vehicle-profile', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                userId: user.id,
                imei: activeImei,
                vehicleProfile,
                initialOdometer
            })
        });
        
        const resDriver = await fetch('/api/customer/update-driver', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                userId: user.id,
                imei: activeImei,
                driverName
            })
        });
        
        const data = await res.json();
        const dataDriver = await resDriver.json();
        
        if (data.success && dataDriver.success) {
            showToast("✅ Configuration Saved", "Vehicle profile and driver updated successfully.", "success");
            
            // Update local devices array
            const dev = myDevices.find(d => d.imei === activeImei);
            if (dev) {
                dev.driverName = driverName;
                dev.vehicleProfile = vehicleProfile;
                dev.initialOdometer = initialOdometer;
            }
            
            // Update lastSeen record locally as well so that next update includes it
            if (latestData[activeImei]) {
                latestData[activeImei].odometer = initialOdometer;
            }
            
            renderDeviceList();
            
            // Re-render panel
            if (latestData[activeImei]) {
                updatePanelData(latestData[activeImei], dev ? dev.name : activeImei);
            }
        } else {
            showToast("❌ Error", "Failed to update configuration.", "danger");
        }
    } catch(e) {
        showToast("❌ Error", "Network error updating configuration.", "danger");
    }
}

// ── CUSTOM FUNCTIONS FOR LINK SHARING ──

function openShareModal() {
    if (!activeImei) return;
    document.getElementById('shareLinkResultContainer').style.display = 'none';
    const dropdown = document.getElementById('shareDuration');
    if (dropdown) {
        dropdown.value = '60';
        toggleCustomDuration('60');
    }
    document.getElementById('shareModal').classList.add('active');
}

function closeShareModal() {
    document.getElementById('shareModal').classList.remove('active');
}

function toggleCustomDuration(val) {
    const container = document.getElementById('customDurationContainer');
    if (container) {
        container.style.display = (val === 'custom') ? 'block' : 'none';
    }
}

async function generateShareLink() {
    if (!activeImei) return;
    
    let duration = document.getElementById('shareDuration').value;
    if (duration === 'custom') {
        const customInput = document.getElementById('customShareMinutes');
        duration = customInput ? customInput.value : '60';
    }
    
    try {
        const res = await fetch('/api/customer/create-share-link', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ imei: activeImei, expiresAfterMinutes: parseInt(duration || 60) })
        });
        const data = await res.json();
        if (data.success && data.link) {
            const shareUrl = `${window.location.origin}/share.html?id=${data.link.id}`;
            document.getElementById('shareLinkUrl').value = shareUrl;
            document.getElementById('shareLinkResultContainer').style.display = 'block';
            showToast("🔗 Link Generated", "Temporary tracking link generated successfully.", "success");
        } else {
            showToast("❌ Error", data.error || "Failed to generate link.", "danger");
        }
    } catch(e) {
        showToast("❌ Error", "Network error generating link.", "danger");
    }
}

function copyShareLink() {
    const input = document.getElementById('shareLinkUrl');
    navigator.clipboard.writeText(input.value).then(() => {
        const btn = document.getElementById('copyShareBtn');
        btn.innerHTML = '<i class="fa-solid fa-check" style="color: var(--success);"></i>';
        setTimeout(() => {
            btn.innerHTML = '<i class="fa-regular fa-copy"></i>';
        }, 2000);
        showToast("📋 Copied", "Link copied to clipboard.", "info");
    });
}

// ── CUSTOM FUNCTIONS FOR CLOCK & DAY/NIGHT THEME ──

let is12HourFormat = true;

function updateClock() {
    const clockEl = document.getElementById('clockTime');
    if (!clockEl) return;
    
    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    if (is12HourFormat) {
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        clockEl.innerText = `${String(hours).padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;
    } else {
        clockEl.innerText = `${String(hours).padStart(2, '0')}:${minutes}:${seconds}`;
    }
}

setInterval(updateClock, 1000);

function toggleClockFormat() {
    const chk = document.getElementById('toggle12Hour');
    is12HourFormat = chk ? chk.checked : true;
    updateClock();
}

function applyTheme(isNight) {
    const icon = document.getElementById('themeToggleIcon');
    if (isNight) {
        document.body.classList.add('theme-night');
        document.body.classList.remove('theme-day');
        if (icon) {
            icon.className = 'fa-solid fa-sun';
            icon.style.color = 'var(--warning)';
        }
        if (map && currentLayerName !== 'standard') {
            map.removeLayer(mapLayers[currentLayerName]);
            currentLayerName = 'standard';
            mapLayers.standard.addTo(map);
        }
    } else {
        document.body.classList.add('theme-day');
        document.body.classList.remove('theme-night');
        if (icon) {
            icon.className = 'fa-solid fa-moon';
            icon.style.color = 'var(--text-secondary)';
        }
        if (map && currentLayerName !== 'standard') {
            map.removeLayer(mapLayers[currentLayerName]);
            currentLayerName = 'standard';
            mapLayers.standard.addTo(map);
        }
    }
}

function checkAutoTheme() {
    // Default to day (light) mode as requested by user
    applyTheme(false);
}

function toggleThemeManual() {
    const isCurrentlyNight = document.body.classList.contains('theme-night');
    applyTheme(!isCurrentlyNight);
}

// Initial triggers
setTimeout(() => {
    checkAutoTheme();
    updateClock();
    const chk = document.getElementById('toggle12Hour');
    if (chk) chk.checked = is12HourFormat;
}, 500);

// Search & filter vehicle cards helper functions
function filterVehicleList() {
    const input = document.getElementById('vehicleSearchInput');
    if (!input) return;
    const filter = input.value.trim().toLowerCase();
    const cards = document.querySelectorAll('.device-card');
    const clearBtn = document.getElementById('vehicleSearchClear');
    
    if (clearBtn) {
        clearBtn.style.display = filter ? 'block' : 'none';
    }
    
    cards.forEach(card => {
        const text = card.innerText.toLowerCase();
        if (text.includes(filter)) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
}

function clearVehicleSearch() {
    const input = document.getElementById('vehicleSearchInput');
    if (input) {
        input.value = '';
        filterVehicleList();
    }
}

// Map tab selector (Live Tracking / Travel Replay)
function switchMapTab(mode) {
    const tabLive = document.getElementById('tabLive');
    const tabReplay = document.getElementById('tabReplay');
    if (!tabLive || !tabReplay) return;
    
    if (mode === 'live') {
        tabLive.classList.add('active');
        tabReplay.classList.remove('active');
        exitHistoryMode();
    } else {
        tabLive.classList.remove('active');
        tabReplay.classList.add('active');
        startHistoryMode();
    }
}

function showSettingsModal() {
    document.getElementById('settingsModal').classList.add('active');
}

function closeSettingsModal() {
    document.getElementById('settingsModal').classList.remove('active');
}
