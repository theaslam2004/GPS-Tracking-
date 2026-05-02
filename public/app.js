// Initialize Map
const map = L.map('map', {
    zoomControl: false // We can add it later if needed in a custom position
}).setView([28.6139, 77.2090], 5); // Default view over India

L.control.zoom({ position: 'bottomright' }).addTo(map);

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Custom marker icon
const carIcon = L.divIcon({
    className: 'custom-marker',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
});

let deviceMarker = null;
let pathLine = L.polyline([], { color: '#3b82f6', weight: 3, opacity: 0.7 }).addTo(map);

// Connect to Socket.io backend
const socket = io();

// DOM Elements
const elImei = document.getElementById('val-imei');
const elSpeed = document.getElementById('val-speed');
const elCoords = document.getElementById('val-coords');
const elTime = document.getElementById('val-time');
const logWindow = document.getElementById('log-window');

// Listen for parsed device data
socket.on('device_data', (data) => {
    // Update Sidebar Telemetry
    elImei.textContent = data.imei;
    elSpeed.textContent = `${data.speed} km/h`;
    elCoords.textContent = `${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)}`;
    
    const date = new Date(data.timestamp);
    elTime.textContent = date.toLocaleTimeString();

    // Update Map
    const newLatLng = new L.LatLng(data.latitude, data.longitude);
    
    if (!deviceMarker) {
        deviceMarker = L.marker(newLatLng, { icon: carIcon }).addTo(map);
        map.setView(newLatLng, 15);
    } else {
        deviceMarker.setLatLng(newLatLng);
        // Smooth pan if the marker is moving out of view
        if(!map.getBounds().contains(newLatLng)) {
            map.panTo(newLatLng);
        }
    }

    // Add point to path
    pathLine.addLatLng(newLatLng);

    // Append raw log
    appendLog(data.rawHex);
});

// Listen for raw data that couldn't be parsed completely
socket.on('raw_log', (data) => {
    appendLog(data.hex);
});

function appendLog(hexString) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    timeSpan.textContent = `[${new Date().toLocaleTimeString()}]`;
    
    const hexSpan = document.createElement('span');
    hexSpan.textContent = hexString;
    
    entry.appendChild(timeSpan);
    entry.appendChild(hexSpan);
    
    logWindow.appendChild(entry);
    
    // Auto-scroll to bottom
    logWindow.scrollTop = logWindow.scrollHeight;
    
    // Keep only last 50 logs to prevent memory issues
    if (logWindow.children.length > 50) {
        logWindow.removeChild(logWindow.firstChild);
    }
}
