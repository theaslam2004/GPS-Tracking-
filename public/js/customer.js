const user = JSON.parse(localStorage.getItem('user'));
if (!user || user.role !== 'customer') {
    window.location.href = 'index.html';
}

// Setup Export link
document.getElementById('exportBtn').href = `/api/export/devices?userId=${user.id}&role=${user.role}`;

let map;
const markers = {};
let myDevices = [];
let latestData = {}; // Store latest telemetry for panel
let activeImei = null;

// Map Layers
const mapLayers = {
    standard: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri' })
};
let currentLayerName = 'standard';

function initMap() {
    map = L.map('map').setView([20.5937, 78.9629], 5);
    mapLayers.standard.addTo(map);
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
    const res = await fetch(`/api/customer/data?userId=${user.id}`);
    const data = await res.json();
    
    myDevices = data.devices;
    
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
    
    container.innerHTML = sortedDevices.map(d => `
        <div class="device-card" id="card-${d.imei}" onclick="focusDevice('${d.imei}')">
            <div class="device-header">
                <div class="device-title">
                    <i class="fa-solid fa-star" style="color: ${d.pinned ? 'var(--warning)' : 'var(--text-secondary)'}; opacity: ${d.pinned ? '1' : '0.5'}; cursor: pointer; margin-right: 6px; transition: all 0.2s;" onclick="togglePin('${d.imei}', event)" title="${d.pinned ? 'Unpin' : 'Pin to top'}"></i>
                    <i class="fa-solid fa-truck"></i> ${d.name || d.imei}
                </div>
                <div style="font-weight: 700; font-size: 0.8rem; color: var(--text-secondary);" id="status-${d.imei}">Offline</div>
            </div>
            <div class="device-stats" style="grid-template-columns: 1fr 1fr 1fr; font-size: 0.75rem;">
                <div class="stat-item"><i class="fa-solid fa-gauge-high"></i> <span id="speed-${d.imei}">0</span> km/h</div>
                <div class="stat-item"><i class="fa-solid fa-road"></i> <span id="odo-${d.imei}">${d.odometer || 0}</span> km</div>
                <div class="stat-item"><i class="fa-regular fa-clock"></i> <span id="time-${d.imei}">--</span></div>
            </div>
        </div>
    `).join('');
    
    document.getElementById('countAll').innerText = myDevices.length;
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
            <div class="telemetry-item">
                <span class="telemetry-label"><i class="fa-solid fa-gauge-high"></i> Speed</span>
                <span class="telemetry-val">${speed} km/h</span>
            </div>
            <div class="telemetry-item">
                <span class="telemetry-label"><i class="fa-solid fa-road"></i> Odometer</span>
                <span class="telemetry-val accent">${odometer ? odometer.toFixed(1) + ' km' : 'N/A'}</span>
            </div>
            <div class="telemetry-item">
                <span class="telemetry-label"><i class="fa-solid fa-battery-full"></i> Battery</span>
                <span class="telemetry-val">${batteryPercentage}% <span style="font-size:0.6rem; color:var(--${batColor});"><i class="fa-solid ${batIcon}"></i></span></span>
            </div>
            <div class="telemetry-item">
                <span class="telemetry-label"><i class="fa-solid fa-location-dot"></i> GPS Lock</span>
                <span class="telemetry-val" style="font-size: 0.8rem;">${fixText} (${satCount})</span>
            </div>
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

socket.on('device_data', (data) => {
    // Only process if this device belongs to this user
    if (data.ownerId !== user.id) return;
    
    const { imei, latitude, longitude, speed, timestamp } = data;
    latestData[imei] = data; // Store latest for panel

    
    // Find device name
    const device = myDevices.find(d => d.imei === imei);
    const deviceName = device ? device.name : imei;
    const popupHTML = buildTelemetryHTML(data, deviceName);
    
    // Update Map
    if(markers[imei]) {
        markers[imei].setLatLng([latitude, longitude]);
        // Update popup if it's currently open
        if(markers[imei].isPopupOpen()) {
            markers[imei].getPopup().setContent(popupHTML);
        } else {
            markers[imei].setPopupContent(popupHTML);
        }
    } else {
        markers[imei] = L.marker([latitude, longitude]).addTo(map)
            .bindPopup(popupHTML)
            .on('click', () => focusDevice(imei));
    }
    
    // Auto-focus logic: Focus the pinned vehicle by default
    if (device && device.pinned && !window.initialFocusDone) {
        window.initialFocusDone = true;
        focusDevice(imei);
    } else if (!window.initialFocusDone && myDevices.every(d => !d.pinned)) {
        // Fallback: If no vehicle is pinned, focus the first one that connects
        window.initialFocusDone = true;
        focusDevice(imei);
    }
    
    // Update Sidebar
    const speedEl = document.getElementById(`speed-${imei}`);
    const timeEl = document.getElementById(`time-${imei}`);
    const statusEl = document.getElementById(`status-${imei}`);
    const odoEl = document.getElementById(`odo-${imei}`);
    
    if(speedEl) {
        speedEl.innerText = speed;
        if(odoEl && data.odometer) odoEl.innerText = data.odometer;
        
        const timeObj = new Date(timestamp);
        timeEl.innerText = timeObj.toLocaleTimeString();
        
        statusEl.innerText = speed > 5 ? 'Running' : 'Idle';
        statusEl.className = '';
        statusEl.style.color = speed > 5 ? 'var(--success)' : 'var(--warning)';
        statusEl.style.background = 'transparent';
    }
    
    // Update panel if it's currently open for this device
    const panel = document.getElementById('vehiclePanel');
    if(panel.classList.contains('open')) {
        const currentPanelDevice = document.getElementById('panelDeviceName').innerText;
        if(currentPanelDevice === deviceName || currentPanelDevice === imei) {
            updatePanelData(data, deviceName);
        }
    }
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
