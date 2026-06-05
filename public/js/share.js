// Share Link Live Tracking Script
let map;
let marker;
let targetImei = null;
let currentLayerName = 'standard';
const mapLayers = {
    standard: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap &copy; CARTO' }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' })
};

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
        document.getElementById('vehicleName').innerText = data.name || data.imei;
        
        // Initialize Map
        map = L.map('map').setView([20.5937, 78.9629], 5);
        mapLayers.standard.addTo(map); // Default to daylight layer
        currentLayerName = 'standard';
        
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
    
    const latlng = [latitude, longitude];
    
    // Update marker
    const isMoving = speed > 5;
    const status = isMoving ? 'running' : 'halt';
    const markerIcon = getVehicleIcon(heading, status);
    
    if (marker) {
        marker.setLatLng(latlng);
        marker.setIcon(markerIcon);
    } else {
        marker = L.marker(latlng, { icon: markerIcon }).addTo(map);
        map.setView(latlng, 15);
    }
    
    // Smooth transition
    map.panTo(latlng);
    
    // Update Info Panel
    document.getElementById('valStatus').innerText = isMoving ? 'Running' : 'Idle';
    document.getElementById('valStatus').style.color = isMoving ? 'var(--primary)' : 'var(--warning)';
    document.getElementById('valSpeed').innerText = `${speed} km/h`;
    document.getElementById('valOdometer').innerText = odometer && odometer > 0 ? `${odometer.toFixed(1)} km` : '--';
    document.getElementById('valTime').innerText = new Date(timestamp).toLocaleTimeString();
}

// Custom vehicle divIcon rotation helper
function getVehicleIcon(heading, status) {
    let color = '#FFab00'; // Idle (Amber)
    let pulseClass = '';
    if (status === 'running') {
        color = '#00E676'; // Moving (Green)
        pulseClass = 'beacon-pulse';
    } else if (status === 'offline') {
        color = '#FF3D00'; // Offline (Red)
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
        iconAnchor: [14, 14]
    });
}
