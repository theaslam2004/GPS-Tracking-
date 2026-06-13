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

        // Default history datetime inputs
        const startDateInput = document.getElementById('pbStartDateInput');
        const endDateInput = document.getElementById('pbEndDateInput');
        if (startDateInput && endDateInput) {
            const now = new Date();
            const yesterday = new Date(now.getTime() - 24*60*60*1000);
            
            const formatDateTimeLocal = (date) => {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                return `${year}-${month}-${day}T${hours}:${minutes}`;
            };
            
            startDateInput.value = formatDateTimeLocal(yesterday);
            endDateInput.value = formatDateTimeLocal(now);
            
            const onCustomDateChange = () => {
                if (activeImei) {
                    loadAndRenderHistory();
                }
            };
            
            startDateInput.addEventListener('change', onCustomDateChange);
            endDateInput.addEventListener('change', onCustomDateChange);
        }
    } catch (e) {
        console.error('[Auth Check] Error validating session:', e);
        localStorage.removeItem('user');
        window.location.href = 'index.html';
    }
})();

let map;
const markers = {};
const liveTrails = {}; // Store recent trail coordinates
const liveTrailPolylines = {}; // Store trail polyline layers
const livePaths = {}; // Store L.polyline paths for breadcrumbs
let myDevices = [];
let latestData = {}; // Store latest telemetry for panel
let activeImei = null;
let userSettings = {};
let currentFilter = 'all';
const addressCache = {};

function getAddress(imei, lat, lng, callback) {
    const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (addressCache[cacheKey]) {
        if (callback) callback(addressCache[cacheKey]);
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
            addressCache[cacheKey] = addr;
            if (callback) callback(addr);
            
            // Proactively update any existing popup/card elements in the DOM
            const popupAddrEl = document.getElementById(`popup-address-${imei}`);
            if (popupAddrEl) popupAddrEl.innerText = addr;
            
            const cardAddrEl = document.getElementById(`card-address-${imei}`);
            if (cardAddrEl) cardAddrEl.innerText = addr;
        })
        .catch(() => {
            const addr = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            addressCache[cacheKey] = addr;
            if (callback) callback(addr);
        });
}

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
    standard: L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '&copy; Google Maps'
    }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }),
    satellite: L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '&copy; Google Maps'
    })
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
    
    // Dynamic address resolver and HTML refresher on popup open
    map.on('popupopen', function(e) {
        const popup = e.popup;
        const container = popup.getElement();
        if (container) {
            const addrEl = container.querySelector('[id^="popup-address-"]');
            if (addrEl) {
                const imei = addrEl.id.replace('popup-address-', '');
                const live = latestData[imei];
                if (live) {
                    // Refresh popup content dynamically to sync elapsed time and offline status
                    const device = myDevices.find(d => d.imei === imei);
                    popup.setContent(buildTelemetryHTML(live, device ? device.name : imei));
                    
                    // Re-resolve address and insert it in the fresh content
                    getAddress(imei, live.latitude, live.longitude, (addr) => {
                        const newAddrEl = popup.getElement().querySelector('[id^="popup-address-"]');
                        if (newAddrEl) newAddrEl.innerText = addr;
                    });
                }
            }
        }
    });
    
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

    // Close sidebar on map click for mobile devices
    map.on('click', function() {
        if (window.innerWidth <= 900) {
            const sidebar = document.querySelector('.sidebar-wrapper');
            if (sidebar) sidebar.classList.remove('open');
        }
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
        const isOdoVerified = (live.odometer !== undefined && live.odometer >= 0);
        const odoVal = isOdoVerified ? live.odometer.toFixed(1) : '--';
        const timeVal = live.timestamp ? new Date(live.timestamp).toLocaleTimeString() : '--';
        
        // Offline status check
        let statusClass = 'offline';
        let statusText = 'Offline';
        if (live.timestamp) {
            const isStale = (Date.now() - new Date(live.timestamp)) > 60000;
            if (!isStale) {
                statusClass = live.status || 'halt';
                statusText = statusClass.charAt(0).toUpperCase() + statusClass.slice(1);
                if (statusClass === 'halt') statusText = 'Halted';
            }
        }
        
        const isSecondary = (live.powerSource === 'secondary');
        const batAlert = isSecondary ? `<i class="fa-solid fa-triangle-exclamation" style="color: var(--danger); margin-left: 6px; animation: pulseGlow 1.5s infinite ease-in-out;" title="Warning: Running on Backup Battery!"></i>` : '';
        const activeClass = (d.imei === activeImei) ? 'active' : '';

        return `
            <div class="device-card ${statusClass} ${activeClass}" id="card-${d.imei}" onclick="focusDevice('${d.imei}')">
                <!-- Card Header -->
                <div class="device-header" style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 8px;">
                    <div class="device-title" style="display: flex; align-items: center; gap: 6px; font-size: 0.88rem; font-weight: 700; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 65%;">
                        <i class="fa-solid fa-star" style="color: ${d.pinned ? 'var(--warning)' : 'var(--text-secondary)'}; opacity: ${d.pinned ? '1' : '0.5'}; cursor: pointer; transition: all 0.2s;" onclick="togglePin('${d.imei}', event)" title="${d.pinned ? 'Unpin' : 'Pin to top'}"></i>
                        <i class="fa-solid fa-truck" style="font-size: 0.85rem; flex-shrink: 0; color: var(--text-secondary);"></i>
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 800; color: var(--text-primary);" title="${d.name || d.imei}">${d.name || d.imei}</span>
                        ${batAlert}
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                        <i class="fa-solid fa-pen-to-square rename-btn" style="cursor: pointer; opacity: 0.5; font-size: 0.75rem; flex-shrink: 0; color: var(--text-secondary);" onclick="renameDevicePrompt('${d.imei}', '${d.name || ''}', event)" title="Rename vehicle"></i>
                        <i class="fa-solid fa-trash delete-device-btn" style="cursor: pointer; opacity: 0.5; font-size: 0.75rem; flex-shrink: 0; color: var(--danger);" onclick="deleteDevicePrompt('${d.imei}', '${d.name || ''}', event)" title="Delete vehicle"></i>
                        <span class="taabi-status-capsule ${statusClass}" style="transform: scale(0.9); transform-origin: right center;">
                            ${statusText}
                        </span>
                    </div>
                </div>

                <!-- Stats Grid -->
                <div class="device-stats" style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.25rem; background: none; border: none; padding: 0.5rem 0 0; margin-top: 0.5rem;">
                    <div class="stat-item" style="display: flex; flex-direction: column; align-items: center; text-align: center; justify-content: center; ${speedHidden}">
                        <i class="fa-solid fa-gauge-high" style="color: var(--success); font-size: 0.95rem; margin-bottom: 2px;"></i>
                        <span style="color: var(--text-primary); font-weight: 700; font-family: 'Outfit', sans-serif; font-size: 0.82rem;" id="speed-${d.imei}">${speedVal}</span>
                        <span style="color: var(--text-secondary); font-size: 0.65rem; text-transform: uppercase; font-weight: 500; letter-spacing: 0.3px;">km/h</span>
                    </div>
                    <div class="stat-item" style="display: flex; flex-direction: column; align-items: center; text-align: center; justify-content: center; ${odoHidden}">
                        <i class="fa-solid fa-road" style="color: var(--primary); font-size: 0.95rem; margin-bottom: 2px;"></i>
                        <span style="color: var(--text-primary); font-weight: 700; font-family: 'Outfit', sans-serif; font-size: 0.82rem;" id="odo-${d.imei}">${odoVal}</span>
                        <span style="color: var(--text-secondary); font-size: 0.65rem; text-transform: uppercase; font-weight: 500; letter-spacing: 0.3px;">km</span>
                    </div>
                    <div class="stat-item" style="display: flex; flex-direction: column; align-items: center; text-align: center; justify-content: center;">
                        <i class="fa-regular fa-clock" style="color: var(--primary); font-size: 0.95rem; margin-bottom: 2px;"></i>
                        <span style="color: var(--text-primary); font-weight: 700; font-family: 'Outfit', sans-serif; font-size: 0.72rem; line-height: 1.2; word-break: break-word; white-space: normal;" id="time-${d.imei}">${timeVal}</span>
                        <span style="color: var(--text-secondary); font-size: 0.65rem; text-transform: uppercase; font-weight: 500; letter-spacing: 0.3px;">Updated</span>
                    </div>
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
        
        // Close sidebar drawer on mobile to show the map and details panel
        if (window.innerWidth <= 900) {
            const sidebar = document.querySelector('.sidebar-wrapper');
            if (sidebar) sidebar.classList.remove('open');
        }
        
        // Populate if we have data
        if(latestData[imei]) {
            const device = myDevices.find(d => d.imei === imei);
            updatePanelData(latestData[imei], device ? device.name : imei);
        }
        loadTodayStats(imei);
    }
}

function updatePanelData(data, deviceName) {
    const { imei, latitude, longitude, speed, timestamp, odometer, battery, gpsValid, satellites } = data;
    const isReplayMode = (document.getElementById('playbackControls') && document.getElementById('playbackControls').style.display === 'flex');
    const isStale = isReplayMode ? false : ((Date.now() - new Date(timestamp)) > 60000);
    
    const device = myDevices.find(d => d.imei === imei);
    
    const reportEl = document.getElementById('panelDailyReport');
    if (reportEl) {
        reportEl.style.display = isReplayMode ? 'none' : 'block';
    }
    
    document.getElementById('panelDeviceName').innerText = deviceName || imei;
    document.getElementById('panelSpeed').innerText = speed;
    
    const profile = device ? device.vehicleProfile || 'standard' : 'standard';
    const profileText = profile === 'heavy' ? 'Heavy (48V)' : 'Standard (12V/24V)';
    const driverName = device ? device.driverName || 'Unassigned' : 'Unassigned';

    const driverNameEl = document.getElementById('panelDriverName');
    if (driverNameEl) driverNameEl.innerText = driverName;
    
    const profileEl = document.getElementById('panelVehicleProfile');
    if (profileEl) profileEl.innerText = profileText;

    const editDriverBtn = document.getElementById('panelEditDriverBtn');
    if (editDriverBtn) {
        editDriverBtn.onclick = (event) => {
            event.stopPropagation();
            assignDriverPrompt(imei, driverName);
        };
    }
    
    // Voltage profile verification
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

    // Toggle 3D View button and container based on vehicle voltage
    const panel3DBtn = document.getElementById('panel3DBtn');
    const panel3DContainer = document.getElementById('panel3DContainer');
    if (panel3DBtn) {
        if (volt > 16.0 && volt <= 32.0) {
            panel3DBtn.style.display = 'inline-flex';
        } else {
            panel3DBtn.style.display = 'none';
            if (panel3DContainer) {
                panel3DContainer.style.display = 'none';
            }
        }
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
    
    // Reverse Geocoding for Address (Using cached getAddress to prevent rate limit issues)
    const coordsEl = document.getElementById('panelCoords');
    coordsEl.innerText = 'Fetching address...';
    getAddress(imei, latitude, longitude, (addr) => {
        coordsEl.innerText = addr;
    });
        
    document.getElementById('panelTime').innerText = new Date(timestamp).toLocaleTimeString();
    
    const odoEl = document.getElementById('panelOdo');
    if (odoEl) {
        const isOdoVerified = (odometer !== undefined && odometer >= 0);
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
    const isStale = (Date.now() - new Date(timestamp)) > 60000;
    
    let status = 'offline';
    let statusText = 'Offline';
    if (!isStale) {
        status = data.status || 'halt';
        statusText = status.charAt(0).toUpperCase() + status.slice(1);
        if (status === 'halt') statusText = 'Halted';
    }

    const device = myDevices.find(d => d.imei === imei);
    const profile = device ? device.vehicleProfile || 'standard' : 'standard';
    const profileText = profile === 'heavy' ? 'Heavy (48V)' : 'Standard (12V/24V)';
    const driverName = device ? device.driverName || 'Unassigned' : 'Unassigned';

    const odoVal = (odometer !== undefined && odometer >= 0) ? `${odometer.toFixed(1)} km` : '--';
    const coordsString = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

    return `
    <div class="taabi-popup" style="padding: 1rem; width: 290px; font-family: 'Outfit', sans-serif;">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-light); padding-bottom: 8px; margin-bottom: 8px;">
            <div style="font-weight: 800; font-size: 1.05rem; letter-spacing: 0.5px; color: var(--text-primary); text-transform: uppercase;">
                ${deviceName || imei}
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
                <span id="popup-address-${imei}" class="popup-address-text" style="color: var(--text-primary); font-weight: 600;">${coordsString}</span>
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

            <!-- Footer: Last updated & View History link -->
            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-light); padding-top: 6px; margin-top: 4px; font-size: 0.68rem;">
                <span>Last Updated: <b style="color: var(--text-primary);">${timeSince(timeObj)}</b></span>
                <a href="#" onclick="event.preventDefault(); startHistoryMode();" style="color: var(--primary); font-weight: 700; text-decoration: none;">View history</a>
            </div>
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

function handleDeviceData(data, isLive = true) {
    const isMine = myDevices.some(d => d.imei === data.imei);
    if (!isMine) return;
    
    const { imei, latitude, longitude, speed, timestamp } = data;
    
    // Trajectory calculated heading to prevent sideways or backward driving
    const prev = latestData[imei];
    let calculatedHeading = data.heading || 0;
    
    if (prev && prev.latitude && prev.longitude && latitude && longitude) {
        const dist = calculateDistance(prev.latitude, prev.longitude, latitude, longitude);
        // Only update heading if the vehicle moved significantly and is moving
        if (dist > 1.5 && speed > 0) {
            calculatedHeading = calculateBearing(prev.latitude, prev.longitude, latitude, longitude);
            data._calculatedHeading = calculatedHeading;
        } else if (prev._calculatedHeading !== undefined) {
            calculatedHeading = prev._calculatedHeading;
            data._calculatedHeading = calculatedHeading;
        }
    } else if (data.heading !== undefined) {
        data._calculatedHeading = data.heading;
    }
    
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

    if (markers[imei]) {
        const marker = markers[imei];
        
        // Recreate icon only if status or pinning changed to avoid thrashed Leaflet markers
        if (marker.status !== beaconStatus || marker.pinned !== isPinned) {
            const vehicleIcon = getVehicleIcon(calculatedHeading, beaconStatus, isPinned, imei, data.voltage);
            marker.setIcon(vehicleIcon);
            marker.status = beaconStatus;
            marker.pinned = isPinned;
        }
        
        // Slide smoothly to new coordinates (match 2s interval when running, fallback to 1.5s)
        const slideDuration = beaconStatus === 'running' ? 2000 : 1500;
        slideMarker(marker, [latitude, longitude], slideDuration);
        
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
        const vehicleIcon = getVehicleIcon(calculatedHeading, beaconStatus, isPinned, imei, data.voltage);
        const marker = L.marker([latitude, longitude], { icon: vehicleIcon }).addTo(map)
            .bindPopup(popupHTML)
            .on('click', () => focusDevice(imei));
        marker.status = beaconStatus;
        marker.pinned = isPinned;
        markers[imei] = marker;
    }

    // Draw 1-minute breadcrumb trail (dashed line)
    if (latitude && longitude && latitude !== 0 && longitude !== 0) {
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

    // Auto-recenter map to follow the arrow (if live and not in history playback)
    const isHistoryActive = document.getElementById('playbackControls') && 
                            document.getElementById('playbackControls').style.display === 'flex';
    if (isLive && activeImei === imei && !isHistoryActive) {
        map.panTo([latitude, longitude], { animate: true });
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
    
    // Add to today's history points if active device and is today
    if (isLive && activeImei === imei && window.todayHistoryPoints) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const todayMs = startOfDay.getTime();
        if (new Date(timestamp).getTime() >= todayMs) {
            window.todayHistoryPoints.push(data);
            window.todayHistoryPoints = window.todayHistoryPoints.filter(p => new Date(p.timestamp).getTime() >= todayMs);
            updateTodayStatsUI();
        }
    }

    // Update panel if it's currently open for this device
    const panel = document.getElementById('vehiclePanel');
    if(panel.classList.contains('open') && activeImei === imei && !isHistoryActive) {
        updatePanelData(data, deviceName);
    }
}

// Generate premium custom rotating vehicle silhouette icon based on profile, name, and battery voltage
function getVehicleIcon(heading, status, pinned, imei, voltage) {
    const id = imei || 'def';
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
    let width = 24;
    let height = 28;

    // Headlight Yellow Glow beams defined safely outside templates with corrected projection angles
    let headlights = '';
    if (statusName === 'running') {
        headlights = `
            <polygon points="9.25,5.2 -20,-35 20,-35 9.25,5.2" fill="url(#lightBeamGrad_${id})" opacity="0.6" style="mix-blend-mode: screen;"/>
            <polygon points="30.75,5.2 20,-35 60,-35 30.75,5.2" fill="url(#lightBeamGrad_${id})" opacity="0.6" style="mix-blend-mode: screen;"/>
        `;
    }

    if (volt <= 16) {
        // Tempo / Delivery Van / Sedan (Ultra Premium Vector Illustration)
        width = 24;
        height = 28;
        svgContent = `
            <svg width="${width}" height="${height}" viewBox="0 0 40 46" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="bodyGrad_${id}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="${topColor}"/>
                        <stop offset="35%" stop-color="#ffffff" stop-opacity="0.35"/>
                        <stop offset="70%" stop-color="${topColor}"/>
                        <stop offset="100%" stop-color="${bottomColor}"/>
                    </linearGradient>
                    <linearGradient id="glassGrad_${id}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#38bdf8"/>
                        <stop offset="40%" stop-color="#0284c7"/>
                        <stop offset="100%" stop-color="#0369a1"/>
                    </linearGradient>
                    <linearGradient id="lightBeamGrad_${id}" x1="0%" y1="100%" x2="0%" y2="0%">
                        <stop offset="0%" stop-color="#fef08a" stop-opacity="0.6"/>
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
                
                <!-- Chrome Bumper -->
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
                <path d="M 13,15 L 27,13" stroke="#ffffff" stroke-width="1" opacity="0.25"/>
                
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

                <!-- Roof Bars -->
                <rect x="8" y="19" width="1.5" height="13" rx="0.5" fill="url(#chromeGrad_${id})" opacity="0.8"/>
                <rect x="30.5" y="19" width="1.5" height="13" rx="0.5" fill="url(#chromeGrad_${id})" opacity="0.8"/>
                <rect x="9.5" y="21" width="21" height="1" fill="url(#chromeGrad_${id})" opacity="0.6"/>
                <rect x="9.5" y="29" width="21" height="1" fill="url(#chromeGrad_${id})" opacity="0.6"/>

                <!-- Sunroof -->
                <rect x="13" y="23" width="14" height="8" rx="1.5" fill="#1e293b" stroke="#475569" stroke-width="0.5" opacity="0.75"/>
                <path d="M 14.5,24 L 25.5,28" stroke="#ffffff" stroke-width="0.75" opacity="0.25"/>

                <!-- Front Cab Visor -->
                <path d="M 8.5,9 C 8.5,9 12,10.2 20,10.2 C 28,10.2 31.5,9 31.5,9 L 30.5,10.5 C 30.5,10.5 25,11.2 20,11.2 C 15,11.2 9.5,10.5 9.5,10.5 Z" fill="#0f172a" opacity="0.85"/>

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
        width = 44;
        height = 44;
        svgContent = `
            <model-viewer src="/models/tata_407.glb" style="width: 44px; height: 44px; pointer-events: none; background-color: transparent;" camera-orbit="145deg 60deg auto" bounds="tight" interaction-prompt="none"></model-viewer>
        `;
    } else {
        // Heavy 12-Wheel Truck / Trailer (Premium Long Body Semi Truck Illustration)
        width = 24;
        height = 31;
        svgContent = `
            <svg width="${width}" height="${height}" viewBox="0 0 40 52" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="bodyGrad_${id}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="${topColor}"/>
                        <stop offset="35%" stop-color="#ffffff" stop-opacity="0.35"/>
                        <stop offset="70%" stop-color="${topColor}"/>
                        <stop offset="100%" stop-color="${bottomColor}"/>
                    </linearGradient>
                    <linearGradient id="glassGrad_${id}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#38bdf8"/>
                        <stop offset="50%" stop-color="#0284c7"/>
                        <stop offset="100%" stop-color="#0369a1"/>
                    </linearGradient>
                    <linearGradient id="lightBeamGrad_${id}" x1="0%" y1="100%" x2="0%" y2="0%">
                        <stop offset="0%" stop-color="#fef08a" stop-opacity="0.6"/>
                        <stop offset="100%" stop-color="#fef08a" stop-opacity="0"/>
                    </linearGradient>
                    <linearGradient id="cabGrad_${id}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#f8fafc"/>
                        <stop offset="30%" stop-color="#ffffff"/>
                        <stop offset="60%" stop-color="#cbd5e1"/>
                        <stop offset="100%" stop-color="#64748b"/>
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
                
                <!-- Side Steps -->
                <rect x="3.5" y="13" width="2.5" height="5" rx="0.5" fill="url(#chromeGrad_${id})" stroke="#1e293b" stroke-width="0.3"/>
                <rect x="34" y="13" width="2.5" height="5" rx="0.5" fill="url(#chromeGrad_${id})" stroke="#1e293b" stroke-width="0.3"/>

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
                
                <!-- Chrome Air Horns on Roof -->
                <rect x="15" y="5.5" width="1.5" height="5" rx="0.4" fill="url(#chromeGrad_${id})"/>
                <rect x="23.5" y="5.5" width="1.5" height="5" rx="0.4" fill="url(#chromeGrad_${id})"/>
                <circle cx="15.75" cy="5" r="1.1" fill="#cbd5e1"/>
                <circle cx="24.25" cy="5" r="1.1" fill="#cbd5e1"/>

                <!-- Cab Visor over Windshield -->
                <path d="M 8.5,8 C 8.5,8 12,9.2 20,9.2 C 28,9.2 31.5,8 31.5,8 L 30.5,9.5 C 30.5,9.5 25,10.2 20,10.2 C 15,10.2 9.5,9.5 9.5,9.5 Z" fill="#1e293b" opacity="0.9"/>

                <!-- Windshield -->
                <path d="M 8.5,11.5 C 8.5,9.5 11.5,8.5 20,8.5 C 28.5,8.5 31.5,9.5 31.5,11.5 L 30.5,13.5 C 30.5,13.5 25,12.5 20,12.5 C 15,12.5 9.5,13.5 9.5,13.5 Z" fill="url(#glassGrad_${id})" stroke="#0f172a" stroke-width="0.5"/>
                <path d="M 11,10.5 L 29,9.5" stroke="#ffffff" stroke-width="1.2" opacity="0.45"/>
                <path d="M 14,11.8 L 26,11" stroke="#ffffff" stroke-width="0.8" opacity="0.25"/>
                
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
    let borderStyle = pinned ? 'border: 2.5px solid #FFab00; box-shadow: 0 0 12px #FFab00;' : 'border: 1.5px solid rgba(255, 255, 255, 0.4); box-shadow: 0 0 8px ' + topColor + ';';
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
                        transform: translate(-50%, 0) scale(0.3) translateX(0);
                        opacity: 0.9;
                    }
                    30% {
                        transform: translate(-50%, 8px) scale(0.9) translateX(-2px);
                        opacity: 0.75;
                    }
                    60% {
                        transform: translate(-50%, 18px) scale(1.5) translateX(2px);
                        opacity: 0.45;
                    }
                    100% {
                        transform: translate(-50%, 28px) scale(2.2) translateX(-3px);
                        opacity: 0;
                    }
                }
                .smoke-container {
                    position: absolute;
                    bottom: -8px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 10px;
                    height: 10px;
                    pointer-events: none;
                    z-index: -1;
                    overflow: visible;
                }
                .smoke-puff {
                    position: absolute;
                    bottom: 0;
                    left: 50%;
                    width: 8px;
                    height: 8px;
                    background: radial-gradient(circle, rgba(220,220,220,0.85) 0%, rgba(180,180,180,0.4) 50%, rgba(150,150,150,0) 100%);
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
            <div style="position: relative; width: 32px; height: 38px; display: flex; align-items: center; justify-content: center; overflow: visible;">
                <div class="heading-arrow" style="transform: rotate(${heading || 0}deg); transition: transform 0.4s ease-out; width: ${width}px; height: ${height}px; display: flex; align-items: center; justify-content: center; transform-origin: center center;">
                    ${svgContent}
                    ${smokeHTML}
                </div>
            </div>
        `,
        iconSize: [32, 38],
        iconAnchor: [16, 19],
        popupAnchor: [0, -16]
    });
}


socket.on('panic_alert', (data) => {
    const settings = userSettings[data.imei] || {};
    const isMine = myDevices.some(d => d.imei === data.imei);
    if (isMine && settings.panicAlert !== false) {
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
    const isMine = myDevices.some(d => d.imei === data.imei);
    if (!isMine || settings.geofenceAlert === false) return;
    
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
let rawHistoryData = [];
let playbackInterval = null;
let playbackIndex = 0;
let isPlaying = false;
let playbackSpeed = 1;
let activeReplayTab = 'summary';

async function startHistoryMode() {
    if(!activeImei) {
        showToast("ℹ️ Select a Vehicle", "Please select a vehicle from the list first to view history.", "warning");
        return;
    }
    
    // Hide all live trails
    Object.keys(liveTrailPolylines).forEach(imei => {
        if (liveTrailPolylines[imei]) map.removeLayer(liveTrailPolylines[imei]);
    });
    
    // UI Changes
    document.querySelector('.bottom-filter').style.display = 'none';
    document.getElementById('playbackControls').style.display = 'flex';
    document.getElementById('vehiclePanel').classList.add('open');
    
    // Toggle sidebar content
    document.getElementById('liveSidebarContent').style.display = 'none';
    document.getElementById('replaySidebar').style.display = 'flex';
    document.getElementById('datePresetContainer').style.display = 'flex';
    
    // Keep sidebar open, select the Replay tab
    const tabLive = document.getElementById('tabLive');
    const tabReplay = document.getElementById('tabReplay');
    if (tabLive && tabReplay) {
        tabLive.classList.remove('active');
        tabReplay.classList.add('active');
    }
    
    // Reset inputs
    document.getElementById('dateRangePreset').value = 'all';
    const customContainer = document.getElementById('pbCustomRangeContainer');
    if (customContainer) customContainer.style.display = 'none';
    
    // Reset custom inputs to last 24h default
    const startDateInput = document.getElementById('pbStartDateInput');
    const endDateInput = document.getElementById('pbEndDateInput');
    if (startDateInput && endDateInput) {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24*60*60*1000);
        
        const formatDateTimeLocal = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        };
        
        startDateInput.value = formatDateTimeLocal(yesterday);
        endDateInput.value = formatDateTimeLocal(now);
    }
    
    await loadAndRenderHistory();
}

async function loadAndRenderHistory() {
    if (!activeImei) return;
    
    // Stop any active playback
    if (isPlaying) {
        isPlaying = false;
        clearInterval(playbackInterval);
        document.getElementById('playBtn').innerHTML = '<i class="fa-solid fa-play"></i>';
    }
    
    try {
        const res = await fetch(`/api/customer/history?imei=${activeImei}`);
        const data = await res.json();
        rawHistoryData = data.history || [];
        
        // Set vehicle title
        const dev = myDevices.find(d => d.imei === activeImei);
        document.getElementById('replayVehicleTitle').innerText = dev ? dev.name : activeImei;
        
        filterAndProcessHistory();
    } catch (e) {
        console.error('Error fetching history:', e);
        showToast("❌ Fetch Error", "Failed to retrieve tracking history.", "danger");
    }
}

async function handleDatePresetChange(preset) {
    const customContainer = document.getElementById('pbCustomRangeContainer');
    if (customContainer) {
        if (preset === 'custom') {
            customContainer.style.display = 'flex';
        } else {
            customContainer.style.display = 'none';
        }
    }
    await loadAndRenderHistory();
}

function filterAndProcessHistory() {
    const preset = document.getElementById('dateRangePreset').value;
    const now = new Date();
    
    let filtered = [];
    if (preset === 'all') {
        filtered = rawHistoryData;
    } else if (preset === '24h') {
        const limit = now.getTime() - (24 * 60 * 60 * 1000);
        filtered = rawHistoryData.filter(pt => new Date(pt.timestamp).getTime() >= limit);
    } else if (preset === '7d') {
        const limit = now.getTime() - (7 * 24 * 60 * 60 * 1000);
        filtered = rawHistoryData.filter(pt => new Date(pt.timestamp).getTime() >= limit);
    } else if (preset === '15d') {
        const limit = now.getTime() - (15 * 24 * 60 * 60 * 1000);
        filtered = rawHistoryData.filter(pt => new Date(pt.timestamp).getTime() >= limit);
    } else if (preset === '30d') {
        const limit = now.getTime() - (30 * 24 * 60 * 60 * 1000);
        filtered = rawHistoryData.filter(pt => new Date(pt.timestamp).getTime() >= limit);
    } else if (preset === 'custom') {
        const startVal = document.getElementById('pbStartDateInput').value;
        const endVal = document.getElementById('pbEndDateInput').value;
        if (startVal && endVal) {
            const startLimit = new Date(startVal).getTime();
            const endLimit = new Date(endVal).getTime();
            filtered = rawHistoryData.filter(pt => {
                const ptTime = new Date(pt.timestamp).getTime();
                return ptTime >= startLimit && ptTime <= endLimit;
            });
        } else {
            filtered = rawHistoryData;
        }
    }
    
    historyData = filtered;
    
    // Pre-calculate trajectory headings for historyData to resolve sideways/backward driving
    let lastHeading = 0;
    for (let i = 0; i < historyData.length; i++) {
        const pt = historyData[i];
        if (i > 0) {
            const prevPt = historyData[i - 1];
            const dist = calculateDistance(prevPt.latitude, prevPt.longitude, pt.latitude, pt.longitude);
            if (dist > 1.5 && pt.speed > 0) {
                lastHeading = calculateBearing(prevPt.latitude, prevPt.longitude, pt.latitude, pt.longitude);
                pt.heading = lastHeading;
            } else {
                pt.heading = lastHeading || pt.heading || 0;
            }
        } else {
            if (historyData.length > 1) {
                const nextPt = historyData[1];
                const dist = calculateDistance(pt.latitude, pt.longitude, nextPt.latitude, nextPt.longitude);
                if (dist > 1.5 && nextPt.speed > 0) {
                    lastHeading = calculateBearing(pt.latitude, pt.longitude, nextPt.latitude, nextPt.longitude);
                    pt.heading = lastHeading;
                } else {
                    pt.heading = pt.heading || 0;
                }
            } else {
                pt.heading = pt.heading || 0;
            }
        }
    }
    
    if (historyData.length === 0) {
        showToast("ℹ️ No History Data", "No tracking points found for the selected range.", "warning");
        // Clear map layers
        if(historyPolyline) { map.removeLayer(historyPolyline); historyPolyline = null; }
        if(historyMarker) { map.removeLayer(historyMarker); historyMarker = null; }
        // Reset slider and labels
        document.getElementById('pbSlider').value = 0;
        document.getElementById('pbSlider').max = 0;
        document.getElementById('pbTime').innerText = "--/--/---- --:--:--";
        document.getElementById('pbSpeed').innerText = "0 km/h";
        document.getElementById('pbRangeLabel').innerText = "Range: --";
        document.getElementById('pbTicks').innerHTML = "";
        document.getElementById('replayTimelineList').innerHTML = `<div style="text-align: center; color: var(--text-secondary); font-size: 0.75rem; padding: 1.5rem 0;">No history points found for this range.</div>`;
        
        // Reset stats
        document.getElementById('tripTotalDistance').innerText = '0.00 km';
        document.getElementById('tripEngineTime').innerText = '0.00 hours';
        document.getElementById('routeTotalRun').innerText = '0m';
        document.getElementById('routeTotalIdle').innerText = '0m';
        document.getElementById('routeTotalHalt').innerText = '0m';
        document.getElementById('routeIdleCount').innerText = '0';
        document.getElementById('routeRunCount').innerText = '0';
        return;
    }
    
    // Draw Polyline (Filtering out invalid 0,0 coordinates)
    const latlngs = historyData
        .filter(p => p.latitude && p.longitude && p.latitude !== 0 && p.longitude !== 0)
        .map(p => [p.latitude, p.longitude]);
    if(historyPolyline) map.removeLayer(historyPolyline);
    if (latlngs.length > 0) {
        historyPolyline = L.polyline(latlngs, {color: '#0052cc', weight: 5, opacity: 0.85}).addTo(map);
        map.fitBounds(historyPolyline.getBounds());
    } else {
        console.warn('[History] No valid coordinates to render history polyline.');
    }
    
    // Setup Marker
    if(historyMarker) map.removeLayer(historyMarker);
    const firstPt = historyData[0];
    let firstStatus = 'halt';
    if (firstPt.speed > 2) firstStatus = 'running';
    else if (firstPt.ignition) firstStatus = 'idle';
    const firstIcon = getVehicleIcon(firstPt.heading || 0, firstStatus, false, activeImei, firstPt.voltage);

    historyMarker = L.marker([firstPt.latitude, firstPt.longitude], {
        icon: firstIcon,
        zIndexOffset: 1000
    }).addTo(map);
    
    // Set classification status property to avoid thrashed Leaflet markers
    historyMarker.status = firstStatus;
    
    // Init Slider
    document.getElementById('pbSlider').max = historyData.length - 1;
    document.getElementById('pbSlider').value = 0;
    playbackIndex = 0;
    updatePlaybackUI(0);
    
    // Populate Date Range Label
    const startT = new Date(historyData[0].timestamp);
    const endT = new Date(historyData[historyData.length - 1].timestamp);
    const startLabelStr = startT.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
    const endLabelStr = endT.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
    document.getElementById('pbRangeLabel').innerText = `Range: ${startLabelStr} - ${endLabelStr}`;
    
    // Compute statistics & vertical timeline
    computeHistoryStatsAndTimeline();
    
    // Generate slider ticks
    generateSliderTicks();
}

function generateSliderTicks() {
    if (historyData.length < 2) return;
    const ticksContainer = document.getElementById('pbTicks');
    if (!ticksContainer) return;
    
    const len = historyData.length;
    const indices = [0, Math.floor(len * 0.33), Math.floor(len * 0.66), len - 1];
    
    let html = '';
    indices.forEach(idx => {
        const pt = historyData[idx];
        if (pt) {
            const d = new Date(pt.timestamp);
            const dateStr = d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
            const timeStr = d.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'});
            html += `<div style="text-align: center;">
                <div>${dateStr}</div>
                <div style="font-size:0.6rem; opacity:0.8;">${timeStr}</div>
            </div>`;
        }
    });
    ticksContainer.innerHTML = html;
}

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const phi1 = lat1 * Math.PI/180;
    const phi2 = lat2 * Math.PI/180;
    const deltaPhi = (lat2-lat1) * Math.PI/180;
    const deltaLambda = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}

function formatDuration(ms) {
    const totalMins = Math.floor(ms / 60000);
    if (totalMins < 1) return '30s';
    if (totalMins < 60) return `${totalMins}m`;
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

function resolveSegmentAddress(segmentIndex, lat, lng, elementId) {
    const dummyImei = `seg-${segmentIndex}`;
    getAddress(dummyImei, lat, lng, (addr) => {
        const el = document.getElementById(elementId);
        if (el) el.innerText = addr;
    });
}

function optimizeSegments(rawSegments) {
    if (rawSegments.length <= 1) return rawSegments;

    // Pass 1: Merge short stops (idle or halt under 2 minutes) into running if surrounded by running, or merge them to avoid rapid alternation.
    let tempSegments = [];
    for (let i = 0; i < rawSegments.length; i++) {
        const current = rawSegments[i];
        const duration = current.endTime.getTime() - current.startTime.getTime();
        
        if ((current.state === 'idle' || current.state === 'halt') && duration < 120000) {
            const prev = tempSegments[tempSegments.length - 1];
            const next = rawSegments[i + 1];
            
            if (prev && prev.state === 'running') {
                prev.endPoint = current.endPoint;
                prev.points = prev.points.concat(current.points);
                prev.endTime = current.endTime;
                continue;
            } else if (next && next.state === 'running') {
                next.startPoint = current.startPoint;
                next.points = current.points.concat(next.points);
                next.startTime = current.startTime;
                continue;
            }
        }
        
        if (current.state === 'running' && duration < 60000) {
            let segDist = 0;
            for (let j = 1; j < current.points.length; j++) {
                segDist += getDistanceInMeters(current.points[j-1].latitude, current.points[j-1].longitude, current.points[j].latitude, current.points[j].longitude);
            }
            if (segDist < 30) {
                const prev = tempSegments[tempSegments.length - 1];
                const next = rawSegments[i + 1];
                
                if (prev && (prev.state === 'idle' || prev.state === 'halt')) {
                    prev.endPoint = current.endPoint;
                    prev.points = prev.points.concat(current.points);
                    prev.endTime = current.endTime;
                    continue;
                } else if (next && (next.state === 'idle' || next.state === 'halt')) {
                    next.startPoint = current.startPoint;
                    next.points = current.points.concat(next.points);
                    next.startTime = current.startTime;
                    continue;
                }
            }
        }
        
        tempSegments.push(current);
    }

    // Pass 2: Consolidate consecutive segments of the same state
    let consolidated = [];
    tempSegments.forEach(seg => {
        if (consolidated.length === 0) {
            consolidated.push(seg);
        } else {
            const last = consolidated[consolidated.length - 1];
            if (last.state === seg.state) {
                last.endPoint = seg.endPoint;
                last.points = last.points.concat(seg.points);
                last.endTime = seg.endTime;
            } else {
                consolidated.push(seg);
            }
        }
    });

    return consolidated;
}

function computeHistoryStatsAndTimeline() {
    // 1. Total Distance
    let totalDistanceMeters = 0;
    for (let i = 1; i < historyData.length; i++) {
        const prev = historyData[i - 1];
        const curr = historyData[i];
        if (prev.latitude && prev.longitude && curr.latitude && curr.longitude) {
            totalDistanceMeters += getDistanceInMeters(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
        }
    }
    const totalDistanceKm = (totalDistanceMeters / 1000).toFixed(2);
    document.getElementById('tripTotalDistance').innerText = `${totalDistanceKm} km`;
    
    // 2. Engine Time (Ignition ON interval accumulation)
    let engineOnMs = 0;
    for (let i = 1; i < historyData.length; i++) {
        const prev = historyData[i - 1];
        const curr = historyData[i];
        if (prev.ignition && curr.ignition) {
            const duration = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
            if (duration > 0 && duration < 600000) { // cap at 10 minutes to avoid giant gaps
                engineOnMs += duration;
            }
        }
    }
    const engineOnHours = (engineOnMs / (1000 * 60 * 60)).toFixed(2);
    document.getElementById('tripEngineTime').innerText = `${engineOnHours} hours`;
    
    // 3. Segment Clustering
    const rawSegments = [];
    let currentSegment = null;
    
    historyData.forEach((pt) => {
        let state = 'halt';
        if (pt.speed > 2) {
            state = 'running';
        } else if (pt.ignition) {
            state = 'idle';
        }
        
        if (!currentSegment) {
            currentSegment = {
                state: state,
                startPoint: pt,
                endPoint: pt,
                points: [pt],
                startTime: new Date(pt.timestamp),
                endTime: new Date(pt.timestamp)
            };
        } else if (currentSegment.state === state) {
            currentSegment.endPoint = pt;
            currentSegment.points.push(pt);
            currentSegment.endTime = new Date(pt.timestamp);
        } else {
            rawSegments.push(currentSegment);
            currentSegment = {
                state: state,
                startPoint: pt,
                endPoint: pt,
                points: [pt],
                startTime: new Date(pt.timestamp),
                endTime: new Date(pt.timestamp)
            };
        }
    });
    if (currentSegment) {
        rawSegments.push(currentSegment);
    }
    
    // Optimize segments to remove jitter / short stops
    const segments = optimizeSegments(rawSegments);
    
    // Render segments to timeline
    let timelineHtml = '';
    let totalRunMs = 0;
    let totalIdleMs = 0;
    let totalHaltMs = 0;
    let idleCount = 0;
    let runCount = 0;

    segments.forEach((seg, index) => {
        const durationMs = seg.endTime.getTime() - seg.startTime.getTime();
        if (seg.state === 'running') {
            totalRunMs += durationMs;
            runCount++;
        } else if (seg.state === 'idle') {
            totalIdleMs += durationMs;
            idleCount++;
        } else {
            totalHaltMs += durationMs;
        }
        
        const durationText = formatDuration(durationMs);
        const timeRangeText = `${seg.startTime.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'})} - ${seg.endTime.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'})}`;
        const dateText = seg.startTime.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
        
        let stateLabel = 'Halted';
        let stateClass = 'halt';
        let detailText = '';
        
        if (seg.state === 'running') {
            stateLabel = 'Running';
            stateClass = 'running';
            let segDist = 0;
            for (let i = 1; i < seg.points.length; i++) {
                segDist += getDistanceInMeters(seg.points[i-1].latitude, seg.points[i-1].longitude, seg.points[i].latitude, seg.points[i].longitude);
            }
            detailText = ` | ${(segDist / 1000).toFixed(2)} km`;
        } else if (seg.state === 'idle') {
            stateLabel = 'Idle';
            stateClass = 'idle';
        }
        
        const elementId = `timeline-address-${index}`;
        const startPt = seg.startPoint;
        
        timelineHtml += `
        <div class="timeline-item">
            <div class="timeline-badge ${stateClass}"></div>
            <div class="timeline-content">
                <div class="timeline-time">${dateText} | ${timeRangeText}</div>
                <div style="font-weight: 700; color: ${stateClass === 'running' ? 'var(--success)' : stateClass === 'idle' ? 'var(--warning)' : 'var(--danger)'};">
                    ${stateLabel} (${durationText}${detailText})
                </div>
                <div class="timeline-location" id="${elementId}">
                    ${startPt.latitude.toFixed(5)}, ${startPt.longitude.toFixed(5)}
                </div>
            </div>
        </div>
        `;
        
        // Resolve address asynchronously with staggered timeout
        setTimeout(() => {
            resolveSegmentAddress(index, startPt.latitude, startPt.longitude, elementId);
        }, index * 150);
    });

    document.getElementById('replayTimelineList').innerHTML = timelineHtml || '<div style="text-align:center; padding:1.5rem; color:var(--text-secondary);">No timeline events to display.</div>';
    
    document.getElementById('routeTotalRun').innerText = formatDuration(totalRunMs);
    document.getElementById('routeTotalIdle').innerText = formatDuration(totalIdleMs);
    document.getElementById('routeTotalHalt').innerText = formatDuration(totalHaltMs);
    document.getElementById('routeIdleCount').innerText = idleCount;
    document.getElementById('routeRunCount').innerText = runCount;
}

function updatePlaybackUI(index) {
    if(!historyData || !historyData[index]) return;
    const pt = historyData[index];
    
    if (historyMarker) {
        let ptStatus = 'halt';
        if (pt.speed > 2) ptStatus = 'running';
        else if (pt.ignition) ptStatus = 'idle';
        
        if (historyMarker.status !== ptStatus) {
            historyMarker.setIcon(getVehicleIcon(pt.heading || 0, ptStatus, false, activeImei, pt.voltage));
            historyMarker.status = ptStatus;
        }
        
        // Calculate smooth sliding duration based on speed multiplier (e.g. 1x: 800ms, 8x: 100ms)
        const stepDuration = 1000 / playbackSpeed;
        const slideDuration = Math.min(stepDuration * 0.8, 1200);
        
        slideMarker(historyMarker, [pt.latitude, pt.longitude], slideDuration);
        
        // Rotate heading arrow smoothly
        const element = historyMarker.getElement();
        if (element) {
            const headingArrow = element.querySelector('.heading-arrow');
            if (headingArrow) {
                headingArrow.style.transform = `rotate(${pt.heading || 0}deg)`;
            }
        }
        // Auto-pan map to follow history marker
        map.panTo([pt.latitude, pt.longitude]);
    }
    
    // Format full date & time
    const timeObj = new Date(pt.timestamp);
    const datePart = timeObj.toLocaleDateString('en-GB'); // DD/MM/YYYY
    const timePart = timeObj.toLocaleTimeString('en-GB'); // HH:MM:SS
    document.getElementById('pbTime').innerText = `${datePart} ${timePart}`;
    document.getElementById('pbSpeed').innerText = `${pt.speed} km/h`;
    
    // Open detailed vehicle panel on the right side if it's not open
    const panel = document.getElementById('vehiclePanel');
    if (panel) panel.classList.add('open');

    // Update the right side details panel with active playback point details in real-time
    const dev = myDevices.find(d => d.imei === activeImei);
    const panelData = {
        ...pt,
        imei: activeImei
    };
    updatePanelData(panelData, dev ? dev.name : activeImei);
}

function startPlaybackLoop() {
    const baseInterval = 800; // 1x = 800ms per point
    const currentInterval = baseInterval / playbackSpeed;
    
    playbackInterval = setInterval(() => {
        playbackIndex++;
        if (playbackIndex >= historyData.length) {
            togglePlayback(); // pause at end
            playbackIndex = historyData.length - 1;
        } else {
            document.getElementById('pbSlider').value = playbackIndex;
            updatePlaybackUI(playbackIndex);
        }
    }, currentInterval);
}

function togglePlayback() {
    isPlaying = !isPlaying;
    const btn = document.getElementById('playBtn');
    
    if(isPlaying) {
        btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
        if(playbackIndex >= historyData.length - 1) playbackIndex = 0; // restart
        startPlaybackLoop();
    } else {
        btn.innerHTML = '<i class="fa-solid fa-play"></i>';
        clearInterval(playbackInterval);
    }
}

function toggleSpeedDropdown(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('speedDropdown');
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

function setPlaybackSpeed(speed) {
    playbackSpeed = speed;
    document.getElementById('speedMultiplierText').innerText = `${speed}x`;
    document.getElementById('speedDropdown').style.display = 'none';
    
    if (isPlaying) {
        clearInterval(playbackInterval);
        startPlaybackLoop();
    }
}

function seekPlayback(val) {
    playbackIndex = parseInt(val);
    updatePlaybackUI(playbackIndex);
}

function recenterReplayMap() {
    if (historyPolyline) {
        map.fitBounds(historyPolyline.getBounds());
    }
}

function switchReplayTab(tab) {
    activeReplayTab = tab;
    const btnSummary = document.getElementById('replayTabSummary');
    const btnAlerts = document.getElementById('replayTabAlerts');
    const contentSummary = document.getElementById('replaySummaryTabContent');
    const contentAlerts = document.getElementById('replayAlertsTabContent');
    
    if (tab === 'summary') {
        btnSummary.classList.add('active-tab');
        btnAlerts.classList.remove('active-tab');
        contentSummary.style.display = 'flex';
        contentAlerts.style.display = 'none';
    } else {
        btnSummary.classList.remove('active-tab');
        btnAlerts.classList.add('active-tab');
        contentSummary.style.display = 'none';
        contentAlerts.style.display = 'flex';
    }
}

function toggleAccordion(contentId, arrowId) {
    const content = document.getElementById(contentId);
    const arrow = document.getElementById(arrowId);
    if (!content || !arrow) return;
    
    if (content.style.display === 'none') {
        content.style.display = 'flex';
        arrow.style.transform = 'rotate(0deg)';
    } else {
        content.style.display = 'none';
        arrow.style.transform = 'rotate(-90deg)';
    }
}

function exportReplayPDF() {
    if (!activeImei || historyData.length === 0) return;
    
    const dev = myDevices.find(d => d.imei === activeImei);
    const devName = dev ? dev.name : activeImei;
    const startT = new Date(historyData[0].timestamp).toLocaleString();
    const endT = new Date(historyData[historyData.length - 1].timestamp).toLocaleString();
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
        <head>
            <title>Trip History Report - ${devName}</title>
            <style>
                body { font-family: 'Outfit', sans-serif; color: #2b354e; padding: 40px; }
                h1 { color: #ff3b70; border-bottom: 2px solid #ff3b70; padding-bottom: 10px; }
                .meta-table { width: 100%; margin-bottom: 30px; border-collapse: collapse; }
                .meta-table td { padding: 8px; border: 1px solid #e2e8f0; }
                .meta-table td.label { font-weight: bold; background: #f8fafc; width: 30%; }
                .timeline-list { margin-top: 20px; }
                .timeline-item { border-left: 2px solid #e2e8f0; padding-left: 20px; position: relative; margin-bottom: 15px; }
                .timeline-item::before { content: ''; position: absolute; left: -6px; top: 4px; width: 10px; height: 10px; border-radius: 50%; background: #ff3b70; }
                .time { font-size: 0.8rem; color: #64748b; font-weight: bold; }
                .state { font-weight: bold; margin-top: 4px; }
                .loc { font-size: 0.75rem; color: #64748b; margin-top: 2px; }
            </style>
        </head>
        <body>
            <h1>Fleetly Replay Report</h1>
            <table class="meta-table">
                <tr><td class="label">Vehicle Name</td><td>${devName}</td></tr>
                <tr><td class="label">IMEI</td><td>${activeImei}</td></tr>
                <tr><td class="label">Time Range</td><td>${startT} - ${endT}</td></tr>
                <tr><td class="label">Total Distance</td><td>${document.getElementById('tripTotalDistance').innerText}</td></tr>
                <tr><td class="label">Engine On Time</td><td>${document.getElementById('tripEngineTime').innerText}</td></tr>
            </table>
            
            <h2>Route Timeline Log</h2>
            <div class="timeline-list">
                ${document.getElementById('replayTimelineList').innerHTML}
            </div>
            
            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(function() { window.close(); }, 500);
                }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

function exportReplayExcel() {
    if (!activeImei) return;
    window.location.href = `/api/export/history/${activeImei}`;
}

function exitHistoryMode() {
    isPlaying = false;
    clearInterval(playbackInterval);
    document.getElementById('playBtn').innerHTML = '<i class="fa-solid fa-play"></i>';
    
    if(historyPolyline) map.removeLayer(historyPolyline);
    if(historyMarker) map.removeLayer(historyMarker);
    
    // Restore all live trails
    Object.keys(liveTrailPolylines).forEach(imei => {
        if (liveTrailPolylines[imei]) liveTrailPolylines[imei].addTo(map);
    });
    
    document.querySelector('.bottom-filter').style.display = 'flex';
    document.getElementById('playbackControls').style.display = 'none';
    
    // Toggle sidebar content back
    document.getElementById('liveSidebarContent').style.display = 'flex';
    document.getElementById('replaySidebar').style.display = 'none';
    document.getElementById('datePresetContainer').style.display = 'none';
    
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

async function deleteDevicePrompt(imei, currentName, event) {
    if (event) event.stopPropagation();
    const confirmed = confirm(`Are you sure you want to delete vehicle "${currentName || imei}" (IMEI: ${imei})?\n\nThis will permanently remove the device and all its history from your account.`);
    if (!confirmed) return;
    
    try {
        const res = await fetch(`/api/customer/device/${imei}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
            showToast("🗑️ Deleted", "Vehicle deleted successfully.", "success");
            myDevices = myDevices.filter(d => d.imei !== imei);
            if (markers[imei]) {
                map.removeLayer(markers[imei]);
                delete markers[imei];
            }
            if (activeImei === imei) {
                closeDetailsPanel();
                activeImei = null;
            }
            renderDeviceList();
        } else {
            showToast("❌ Error", "Failed to delete vehicle.", "danger");
        }
    } catch(e) {
        showToast("❌ Error", "Network error while deleting.", "danger");
    }
}

async function assignDriverPrompt(imei, currentDriver) {
    const newDriver = prompt("Enter driver name to assign:", currentDriver === 'Unassigned' ? '' : currentDriver);
    if (newDriver === null) return; // cancelled
    
    try {
        const res = await fetch('/api/customer/update-driver', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ userId: user.id, imei, driverName: newDriver.trim() })
        });
        const data = await res.json();
        if (data.success) {
            showToast("✅ Driver Assigned", "Driver assigned successfully.", "success");
            
            // update local device array
            const dev = myDevices.find(d => d.imei === imei);
            if (dev) dev.driverName = newDriver.trim() || 'Unassigned';
            
            // update the panel driver element
            const driverNameEl = document.getElementById('panelDriverName');
            if (driverNameEl && activeImei === imei) {
                driverNameEl.innerText = newDriver.trim() || 'Unassigned';
            }
            
            // Re-render map marker popup
            if (markers[imei] && latestData[imei]) {
                const deviceName = dev ? dev.name : imei;
                markers[imei].setPopupContent(buildTelemetryHTML(latestData[imei], deviceName));
            }
        } else {
            showToast("❌ Error", "Failed to assign driver.", "danger");
        }
    } catch(e) {
        showToast("❌ Error", "Network error while assigning driver.", "danger");
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

// Periodic cleanup of trail points older than 1 minute
setInterval(() => {
    const oneMinuteAgo = Date.now() - 60000;
    Object.keys(liveTrails).forEach(imei => {
        if (liveTrails[imei]) {
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
    });
}, 5000);

// Periodically refresh the device list and active panel to sync elapsed time and offline status
setInterval(() => {
    renderDeviceList();
    const isHistoryActive = document.getElementById('playbackControls') && 
                            document.getElementById('playbackControls').style.display === 'flex';
    if (activeImei && latestData[activeImei] && !isHistoryActive) {
        const device = myDevices.find(d => d.imei === activeImei);
        updatePanelData(latestData[activeImei], device ? device.name : activeImei);
    }
}, 10000);

// Close speed multiplier dropdown when clicking outside
window.addEventListener('click', () => {
    const dropdown = document.getElementById('speedDropdown');
    if (dropdown) dropdown.style.display = 'none';
});

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
        
        // Easing function: linear when running, easeOutCubic otherwise
        const isRunning = marker.status === 'running';
        const ease = isRunning ? progress : (1 - Math.pow(1 - progress, 3));
        
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
    
    Object.keys(markers).forEach(imei => {
        const marker = markers[imei];
        if (!marker) return;
        
        // Skip dead reckoning if the marker is currently sliding to a new packet coordinate
        if (marker._slideAnimationId) return;
        
        const data = latestData[imei];
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
                    
                    marker.setLatLng([newLat, newLng]);
                    
                    // Pan map smoothly to follow focused device
                    const isHistoryActive = document.getElementById('playbackControls') && 
                                            document.getElementById('playbackControls').style.display === 'flex';
                    if (activeImei === imei && !isHistoryActive) {
                        const isMobile = window.innerWidth <= 900;
                        const isFocused = document.body.classList.contains('mobile-device-focused');
                        if (!isMobile || isFocused) {
                            map.panTo([newLat, newLng], { animate: true });
                        }
                    }
                }
            } else {
                marker._lastDeadReckonTick = null;
            }
        } else {
            marker._lastDeadReckonTick = null;
        }
    });
}, 100);

// ==========================================
// Today's Activity Summary Report Logic
// ==========================================
window.todayHistoryPoints = [];

async function loadTodayStats(imei) {
    if (!imei) return;
    try {
        const res = await fetch(`/api/customer/history?imei=${imei}`);
        const data = await res.json();
        const allPoints = data.history || [];
        
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const todayMs = startOfDay.getTime();
        
        window.todayHistoryPoints = allPoints.filter(p => new Date(p.timestamp).getTime() >= todayMs);
        updateTodayStatsUI();
    } catch (e) {
        console.error('[Today Report] Failed to load today stats:', e);
    }
}

function updateTodayStatsUI() {
    const points = window.todayHistoryPoints || [];
    
    let totalDistanceMeters = 0;
    let engineOnMs = 0;
    let driveMs = 0;
    let idleMs = 0;
    let haltMs = 0;
    
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        
        if (prev.latitude && prev.longitude && curr.latitude && curr.longitude) {
            totalDistanceMeters += getDistanceInMeters(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
        }
        
        const duration = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
        if (duration > 0 && duration < 600000) { // cap at 10 minutes to avoid giant gaps
            if (prev.ignition && curr.ignition) {
                engineOnMs += duration;
            }
            
            let state = 'halt';
            if (prev.speed > 2) {
                state = 'running';
            } else if (prev.ignition) {
                state = 'idle';
            }
            
            if (state === 'running') driveMs += duration;
            else if (state === 'idle') idleMs += duration;
            else haltMs += duration;
        }
    }
    
    const distanceKm = (totalDistanceMeters / 1000).toFixed(2);
    
    const totalEngineMins = Math.floor(engineOnMs / 60000);
    const engineHrs = Math.floor(totalEngineMins / 60);
    const engineMins = totalEngineMins % 60;
    const engineTimeStr = `${engineHrs}h ${engineMins}m`;
    
    function formatToMins(ms) {
        const m = Math.floor(ms / 60000);
        if (m < 60) return `${m}m`;
        return `${Math.floor(m / 60)}h ${m % 60}m`;
    }
    
    // Update DOM elements
    const distEl = document.getElementById('panelTodayDistance');
    const engineEl = document.getElementById('panelTodayEngineTime');
    const runEl = document.getElementById('panelTodayRun');
    const idleEl = document.getElementById('panelTodayIdle');
    const haltEl = document.getElementById('panelTodayHalt');
    
    if (distEl) distEl.innerText = `${distanceKm} km`;
    if (engineEl) engineEl.innerText = engineTimeStr;
    if (runEl) runEl.innerText = formatToMins(driveMs);
    if (idleEl) idleEl.innerText = formatToMins(idleMs);
    if (haltEl) haltEl.innerText = formatToMins(haltMs);
}

function exportTodayReportPDF() {
    if (!activeImei || !window.todayHistoryPoints || window.todayHistoryPoints.length === 0) {
        showToast("ℹ️ No Data", "No telemetry data to export for today.", "warning");
        return;
    }
    
    const dev = myDevices.find(d => d.imei === activeImei);
    const devName = dev ? dev.name : activeImei;
    const todayStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
    const dist = document.getElementById('panelTodayDistance').innerText;
    const eng = document.getElementById('panelTodayEngineTime').innerText;
    const run = document.getElementById('panelTodayRun').innerText;
    const idle = document.getElementById('panelTodayIdle').innerText;
    const halt = document.getElementById('panelTodayHalt').innerText;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
        <head>
            <title>Today's Activity Report - ${devName}</title>
            <style>
                body { font-family: 'Outfit', sans-serif; color: #2b354e; padding: 40px; }
                h1 { color: #ff3b70; border-bottom: 2px solid #ff3b70; padding-bottom: 10px; margin-bottom: 5px; }
                .date-subtitle { font-size: 1rem; color: #64748b; margin-bottom: 20px; font-weight: 600; }
                .meta-table { width: 100%; margin-bottom: 30px; border-collapse: collapse; }
                .meta-table td { padding: 10px 12px; border: 1px solid #e2e8f0; font-size: 0.9rem; }
                .meta-table td.label { font-weight: bold; background: #f8fafc; width: 35%; }
                .stats-container { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-bottom: 30px; }
                .stat-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #f8fafc; text-align: center; }
                .stat-card .title { font-size: 0.75rem; color: #64748b; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; }
                .stat-card .value { font-size: 1.25rem; font-weight: 800; color: #ff3b70; margin-top: 5px; }
            </style>
        </head>
        <body>
            <h1>Today's Fleet Activity Summary</h1>
            <div class="date-subtitle">${todayStr}</div>
            
            <table class="meta-table">
                <tr><td class="label">Vehicle Name</td><td><b>${devName}</b></td></tr>
                <tr><td class="label">IMEI Number</td><td>${activeImei}</td></tr>
                <tr><td class="label">Total Distance Travelled</td><td><b>${dist}</b></td></tr>
                <tr><td class="label">Engine Active Duration</td><td><b>${eng}</b></td></tr>
            </table>
            
            <h2>Time Distribution</h2>
            <div class="stats-container">
                <div class="stat-card">
                    <div class="title" style="color: #22c55e;">Driving Duration</div>
                    <div class="value" style="color: #22c55e;">${run}</div>
                </div>
                <div class="stat-card">
                    <div class="title" style="color: #eab308;">Idle Duration</div>
                    <div class="value" style="color: #eab308;">${idle}</div>
                </div>
                <div class="stat-card">
                    <div class="title" style="color: #ef4444;">Halted Duration</div>
                    <div class="value" style="color: #ef4444;">${halt}</div>
                </div>
            </div>
            
            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(function() { window.close(); }, 500);
                }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

function exportTodayReportExcel() {
    if (!activeImei || !window.todayHistoryPoints || window.todayHistoryPoints.length === 0) {
        showToast("ℹ️ No Data", "No telemetry data to export for today.", "warning");
        return;
    }
    const dev = myDevices.find(d => d.imei === activeImei);
    const devName = dev ? dev.name : activeImei;
    
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Timestamp,Latitude,Longitude,Speed (km/h),Odometer (km),Ignition,Voltage,Power Source\n";
    window.todayHistoryPoints.forEach(p => {
        const row = [
            new Date(p.timestamp).toISOString(),
            p.latitude,
            p.longitude,
            p.speed,
            p.odometer || 0,
            p.ignition ? "ON" : "OFF",
            p.voltage || 0,
            p.powerSource || "primary"
        ].join(",");
        csvContent += row + "\n";
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Today_Report_${devName}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==========================================
// Client Account & Device Assignment Modals Logic
// ==========================================
window.currentAssignSubUserId = null;

async function showSubUsersModal() {
    document.getElementById('subUsersModal').classList.add('active');
    await loadSubUsers();
}

function closeSubUsersModal() {
    document.getElementById('subUsersModal').classList.remove('active');
}

async function loadSubUsers() {
    const tableBody = document.getElementById('subUsersListTable');
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--text-secondary);"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading clients...</td></tr>';
    
    try {
        const res = await fetch('/api/customer/sub-users');
        const data = await res.json();
        
        if (data.success && data.subUsers) {
            if (data.subUsers.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--text-secondary);">No clients created yet. Click "Add Client" to create one.</td></tr>';
                return;
            }
            
            tableBody.innerHTML = data.subUsers.map(su => {
                const assignedDevices = myDevices.filter(d => d.assignedTo && d.assignedTo.includes(su.id));
                const deviceNames = assignedDevices.map(d => d.name || d.imei).join(', ') || 'None';
                
                return `
                    <tr style="border-bottom: 1px solid var(--border);">
                        <td style="padding: 12px; color: var(--text-primary); font-weight: 700;">
                            <div>${su.username}</div>
                            <div style="font-size: 0.68rem; color: var(--text-secondary); margin-top: 2px;">
                                Assigned Devices: <span style="color: var(--primary); font-weight: 600;">${deviceNames}</span>
                            </div>
                        </td>
                        <td style="padding: 12px; color: var(--text-secondary);">
                            <div>${su.phone || 'No phone'}</div>
                            <div style="font-size: 0.68rem; opacity: 0.8;">${su.email || 'No email'}</div>
                        </td>
                        <td style="padding: 12px; text-align: right;">
                            <button class="btn btn-outline" onclick="openAssignDevicesModal('${su.id}', '${su.username}')" style="font-size: 0.72rem; padding: 4px 10px;">
                                <i class="fa-solid fa-link"></i> Assign Devices
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        } else {
            tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--danger);">Failed to load clients.</td></tr>';
        }
    } catch (e) {
        console.error("Failed to load sub users", e);
        tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--danger);">Connection error.</td></tr>';
    }
}

function showCreateSubUserModal() {
    document.getElementById('subUsername').value = '';
    document.getElementById('subPassword').value = '';
    document.getElementById('subPhone').value = '';
    document.getElementById('subEmail').value = '';
    document.getElementById('createSubUserModal').classList.add('active');
}

function closeCreateSubUserModal() {
    document.getElementById('createSubUserModal').classList.remove('active');
}

async function submitCreateSubUser() {
    const username = document.getElementById('subUsername').value.trim();
    const password = document.getElementById('subPassword').value;
    const phone = document.getElementById('subPhone').value.trim();
    const email = document.getElementById('subEmail').value.trim();
    
    if (!username || !password) {
        showToast("⚠️ Warning", "Username and password are required.", "warning");
        return;
    }
    
    try {
        const res = await fetch('/api/customer/sub-users/create', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username, password, phone, email })
        });
        const data = await res.json();
        
        if (data.success) {
            showToast("✅ Success", `Client account '${username}' created successfully.`, "success");
            closeCreateSubUserModal();
            loadSubUsers();
        } else {
            showToast("❌ Error", data.error || "Failed to create client account.", "danger");
        }
    } catch (e) {
        console.error("Failed to create sub user", e);
        showToast("❌ Error", "Connection failed.", "danger");
    }
}

function openAssignDevicesModal(subUserId, username) {
    window.currentAssignSubUserId = subUserId;
    const nameEl = document.getElementById('assignTargetUsername');
    if (nameEl) nameEl.innerText = username;
    
    const container = document.getElementById('assignDevicesCheckboxList');
    if (!container) return;
    container.innerHTML = '';
    
    myDevices.forEach(d => {
        const isAssignedToThisSub = d.assignedTo && d.assignedTo.includes(subUserId);
        
        container.innerHTML += `
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px; border-radius: 4px; background: var(--bg-surface); border: 1px solid var(--border-light); font-size: 0.8rem; color: var(--text-primary);">
                <input type="checkbox" class="assign-device-checkbox" data-imei="${d.imei}" data-was-assigned="${isAssignedToThisSub}" ${isAssignedToThisSub ? 'checked' : ''} style="accent-color: var(--primary); cursor: pointer;">
                <div>
                    <span style="font-weight: 700; color: var(--text-primary);">${d.name || d.imei}</span>
                    <span style="font-size: 0.65rem; color: var(--text-secondary); display: block;">IMEI: ${d.imei}</span>
                </div>
            </label>
        `;
    });
    
    document.getElementById('assignDevicesModal').classList.add('active');
}

function closeAssignDevicesModal() {
    document.getElementById('assignDevicesModal').classList.remove('active');
}

async function submitDeviceAssignments() {
    const subUserId = window.currentAssignSubUserId;
    if (!subUserId) return;
    
    const checkboxes = document.querySelectorAll('.assign-device-checkbox');
    showToast("⚙️ Saving", "Saving device assignments...", "info");
    
    try {
        for (const cb of checkboxes) {
            const imei = cb.dataset.imei;
            const wasAssigned = cb.dataset.wasAssigned === 'true';
            const isChecked = cb.checked;
            
            if (isChecked && !wasAssigned) {
                await fetch('/api/customer/sub-users/assign-device', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ imei, subUserId, assign: true })
                });
            } else if (!isChecked && wasAssigned) {
                await fetch('/api/customer/sub-users/assign-device', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ imei, subUserId, assign: false })
                });
            }
        }
        showToast("✅ Saved", "Device assignments updated successfully.", "success");
        closeAssignDevicesModal();
        loadData();
    } catch (e) {
        console.error("Failed to save device assignments", e);
        showToast("❌ Error", "Failed to update assignments.", "danger");
    }
}

// ==========================================
// 3D Model Viewer Logic
// ==========================================
function toggle3DView() {
    const container = document.getElementById('panel3DContainer');
    if (!container) return;
    
    const isVisible = container.style.display === 'flex';
    container.style.display = isVisible ? 'none' : 'flex';
}

// Global model-viewer event listener to hide fallback immediately on load (avoid race conditions)
document.addEventListener('DOMContentLoaded', () => {
    const modelViewer = document.getElementById('tataModelViewer');
    const fallback = document.getElementById('modelViewerFallback');
    if (modelViewer) {
        modelViewer.addEventListener('load', () => {
            if (fallback) fallback.style.display = 'none';
        });
        modelViewer.addEventListener('error', () => {
            if (fallback) fallback.style.display = 'flex';
        });
        // Check if already loaded
        if (modelViewer.loaded) {
            if (fallback) fallback.style.display = 'none';
        }
    }
});
