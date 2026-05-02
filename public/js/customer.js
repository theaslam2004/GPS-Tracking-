const user = JSON.parse(localStorage.getItem('user'));
if (!user || user.role !== 'customer') {
    window.location.href = 'index.html';
}

// Setup Export link
document.getElementById('exportBtn').href = `/api/export/devices?userId=${user.id}&role=${user.role}`;

let map;
const markers = {};
let myDevices = [];

function initMap() {
    map = L.map('map').setView([20.5937, 78.9629], 5); // India center default
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
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

function renderDeviceList() {
    const container = document.getElementById('deviceList');
    if (myDevices.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); margin-top: 2rem;">No devices found. Request one to start tracking.</div>';
        return;
    }
    
    container.innerHTML = myDevices.map(d => `
        <div class="device-card" id="card-${d.imei}" onclick="focusDevice('${d.imei}')">
            <div class="device-header">
                <div class="device-title"><i class="fa-solid fa-truck"></i> ${d.name || d.imei}</div>
                <div class="status-badge status-offline" id="status-${d.imei}">Offline</div>
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

function focusDevice(imei) {
    if(markers[imei]) {
        map.panTo(markers[imei].getLatLng());
        markers[imei].openPopup();
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
    const { imei, latitude, longitude, speed, timestamp, odometer } = data;
    const timeObj = new Date(timestamp);
    
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
                <span class="telemetry-val">98% <span style="font-size:0.6rem; color:var(--success);"><i class="fa-solid fa-bolt"></i></span></span>
            </div>
            <div class="telemetry-item">
                <span class="telemetry-label"><i class="fa-solid fa-location-dot"></i> GPS Lock</span>
                <span class="telemetry-val" style="font-size: 0.8rem;">${latitude.toFixed(4)}, ${longitude.toFixed(4)}</span>
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
            .bindPopup(popupHTML);
        // Pan to first data point
        map.setView([latitude, longitude], 13);
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
        
        statusEl.innerText = speed > 0 ? 'Running' : 'Halt';
        statusEl.className = speed > 0 ? 'status-badge status-online' : 'status-badge status-offline';
        if(speed === 0) {
            statusEl.style.background = '#fef3c7';
            statusEl.style.color = '#92400e';
            statusEl.innerText = 'Idle';
        }
    }
});

initMap();
loadData();
