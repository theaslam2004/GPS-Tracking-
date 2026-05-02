const net = require('net');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const parseDeviceData = require('./parser');
const store = require('./store');

const TCP_PORT = 8080;
const HTTP_PORT = 3000;

// Setup Express and HTTP server for the Frontend
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API: Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = store.getUser(username, password);
    if (user) {
        res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
    } else {
        res.json({ success: false, error: 'Invalid credentials' });
    }
});

// API: Admin endpoints
app.get('/api/admin/dashboard', (req, res) => {
    res.json({
        customers: store.getAllCustomers(),
        requests: store.getPendingRequests(),
        allDevices: store.getData().devices,
        lastSeen: store.getData().deviceLastSeen
    });
});

app.post('/api/admin/create-customer', (req, res) => {
    const { username, password } = req.body;
    const user = store.createUser(username, password);
    if (user) res.json({ success: true, user });
    else res.json({ success: false, error: 'Username already exists' });
});

app.post('/api/admin/update-validity', (req, res) => {
    const { userId, days } = req.body;
    const success = store.updateSubscriptionValidity(userId, days);
    res.json({ success });
});

app.post('/api/admin/approve-device', (req, res) => {
    const { requestId } = req.body;
    const success = store.approveRequest(requestId);
    res.json({ success });
});

// API: Customer endpoints
app.post('/api/customer/request-device', (req, res) => {
    const { userId, imei } = req.body;
    const result = store.requestDevice(userId, imei);
    if (result.error) res.json({ success: false, error: result.error });
    else res.json({ success: true, request: result });
});

app.get('/api/customer/data', (req, res) => {
    const userId = req.query.userId;
    res.json({
        devices: store.getCustomerDevices(userId),
        subscription: store.getCustomerSubscription(userId)
    });
});

// API: Export Excel / CSV
app.get('/api/export/devices', (req, res) => {
    const userId = req.query.userId;
    const role = req.query.role;
    
    let devices = [];
    if (role === 'admin') {
        devices = store.getData().devices;
    } else {
        devices = store.getCustomerDevices(userId);
    }
    
    const lastSeen = store.getData().deviceLastSeen;
    
    let csv = "IMEI,Name,OwnerID,LastLatitude,LastLongitude,LastSpeed,LastTimestamp\n";
    devices.forEach(d => {
        const ls = lastSeen[d.imei] || {};
        csv += `${d.imei},${d.name},${d.ownerId},${ls.latitude || ''},${ls.longitude || ''},${ls.speed || ''},${ls.timestamp || ''}\n`;
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="devices_export.csv"');
    res.send(csv);
});

// Socket.io for Real-time communication with the web frontend
io.on('connection', (socket) => {
    console.log('[Web] A client connected');
    socket.on('disconnect', () => {
        console.log('[Web] Client disconnected');
    });
});

server.listen(HTTP_PORT, () => {
    console.log(`[HTTP] Web Interface listening on http://localhost:${HTTP_PORT}`);
});

// Setup TCP server for the GPS Devices
const tcpServer = net.createServer((socket) => {
    const clientAddress = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[TCP] Device connected from: ${clientAddress}`);

    socket.on('data', (data) => {
        console.log(`[TCP] Received raw data from ${clientAddress} (${data.length} bytes)`);
        
        // Pass the raw buffer to our parser
        const parsedData = parseDeviceData(data);
        
        if (parsedData) {
            console.log(`[TCP] Parsed Data:`, parsedData);
            
            // Update last seen in store
            store.updateDeviceLastSeen(parsedData.imei, parsedData);
            
            // Identify owner
            const devices = store.getData().devices;
            const device = devices.find(d => d.imei === parsedData.imei);
            if (device) {
                parsedData.ownerId = device.ownerId;
                
                // Subscription Lockout Check
                const sub = store.getCustomerSubscription(device.ownerId);
                if (sub && sub.daysLeft <= 0) {
                    console.log(`[TCP] Blocked data for ${parsedData.imei} due to expired subscription.`);
                    // Notify frontend of lockout
                    io.emit('subscription_expired', { ownerId: device.ownerId });
                    return; // Stop here, do not broadcast
                }
            }

            // Broadcast the parsed data to all connected web clients
            io.emit('device_data', parsedData);
        } else {
            console.log(`[TCP] Could not parse data (or not a location packet). Sending raw to UI.`);
            // Send raw data to frontend for debugging
            io.emit('raw_log', {
                time: new Date().toISOString(),
                hex: data.toString('ascii')
            });
        }
    });

    socket.on('error', (err) => {
        console.error(`[TCP] Socket error from ${clientAddress}:`, err.message);
    });

    socket.on('close', () => {
        console.log(`[TCP] Device disconnected: ${clientAddress}`);
    });
});

tcpServer.listen(TCP_PORT, () => {
    console.log(`[TCP] GPS Tracker Server listening on port ${TCP_PORT}`);
    console.log(`[TCP] Point your device to this IP/Port!`);
});
