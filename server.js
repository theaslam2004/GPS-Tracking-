const net = require('net');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const parseDeviceData = require('./parser');
const store = require('./store');
const emailService = require('./emailService');
const smsService = require('./smsService');

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
    console.log(`[HTTP] Login attempt for user: ${username}`);
    const user = store.getUser(username, password);
    if (user) {
        console.log(`[HTTP] Login successful for: ${username}`);
        res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
    } else {
        console.log(`[HTTP] Login failed for: ${username}`);
        res.json({ success: false, error: 'Invalid credentials' });
    }
});

// API: Customer endpoints
app.post('/api/customer/request-device', (req, res) => {
    const { userId, imei } = req.body;
    const result = store.requestDevice(userId, imei);
    if (result.error) {
        res.json({ success: false, error: result.error });
    } else {
        io.emit('admin_update');
        res.json({ success: true, request: result });
    }
});

app.post('/api/customer/pin-device', (req, res) => {
    const { userId, imei } = req.body;
    const pinned = store.togglePinDevice(userId, imei);
    res.json({ success: true, pinned });
});

app.get('/api/customer/data', (req, res) => {
    const userId = req.query.userId;
    res.json({
        devices: store.getCustomerDevices(userId),
        subscription: store.getCustomerSubscription(userId)
    });
});

app.get('/api/customer/history', (req, res) => {
    const imei = req.query.imei;
    res.json({
        history: store.getHistory(imei)
    });
});
app.get('/api/customer/settings', (req, res) => {
    const userId = req.query.userId;
    const devices = store.getCustomerDevices(userId);
    const settingsMap = {};
    devices.forEach(d => {
        settingsMap[d.imei] = store.getDeviceSettings(d.imei);
    });
    res.json(settingsMap);
});

// API: Geofences
app.get('/api/customer/geofences', (req, res) => {
    const userId = req.query.userId;
    console.log(`[HTTP] Fetching geofences for user: ${userId}`);
    res.json(store.getGeofences(userId));
});
app.post('/api/customer/geofence', (req, res) => {
    console.log(`[HTTP] Adding new geofence: ${req.body.name}`);
    res.json(store.addGeofence(req.body));
});
app.post('/api/customer/geofence/update/:id', (req, res) => {
    console.log(`[HTTP] Updating geofence ID: ${req.params.id} with Name: ${req.body.name}`);
    res.json({ success: store.updateGeofence(req.params.id, req.body) });
});
app.delete('/api/customer/geofence/:id', (req, res) => {
    console.log(`[HTTP] Deleting geofence ID: ${req.params.id}`);
    res.json({ success: store.deleteGeofence(req.params.id) });
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

app.get('/api/export/history/:imei', (req, res) => {
    const imei = req.params.imei;
    const history = store.getHistory(imei);
    
    let csv = "Timestamp,Latitude,Longitude,Speed,Odometer,RawData\n";
    history.forEach(pt => {
        csv += `${pt.timestamp},${pt.latitude},${pt.longitude},${pt.speed},${pt.odometer},"${pt.rawHex}"\n`;
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="history_${imei}.csv"`);
    res.send(csv);
});

// -----------------------------------------------------------------------
// ADMIN API ENDPOINTS
// -----------------------------------------------------------------------
app.get('/api/admin/dashboard', (req, res) => {
    const data = store.getData();
    res.json({
        customers: store.getAllCustomers(),
        allDevices: data.devices,
        requests: data.deviceRequests
    });
});

app.post('/api/admin/approve-request', (req, res) => {
    const { imei, ownerId } = req.body;
    const success = store.approveDeviceRequest(imei, ownerId);
    if (success) {
        io.emit('admin_update');
        io.emit('customer_update', { userId: ownerId });
    }
    res.json({ success });
});

app.delete('/api/admin/delete-customer/:userId', (req, res) => {
    const success = store.deleteCustomer(req.params.userId);
    if (success) io.emit('admin_update');
    res.json({ success });
});

app.post('/api/admin/update-contact', (req, res) => {
    const { userId, phone, email } = req.body;
    const success = store.updateContact(userId, phone, email);
    if (success) io.emit('admin_update');
    res.json({ success });
});

app.post('/api/admin/update-validity', (req, res) => {
    const { userId, days } = req.body;
    const success = store.addSubscriptionDays(userId, parseInt(days));
    if (success) io.emit('admin_update');
    res.json({ success });
});

app.get('/api/admin/customer-settings/:userId', (req, res) => {
    // This is a bulk action helper - returns settings for the user (or default if no global user settings)
    const settings = store.getUserSettings(req.params.userId);
    res.json(settings);
});

app.post('/api/admin/update-customer-settings', (req, res) => {
    const { userId, settings } = req.body;
    // Bulk update all devices for this user
    const devices = store.getCustomerDevices(userId);
    devices.forEach(d => {
        store.updateDeviceSettings(d.imei, settings);
        io.emit('settings_updated', { imei: d.imei, settings, userId });
    });
    io.emit('admin_update');
    res.json({ success: true });
});

app.get('/api/admin/device-settings/:imei', (req, res) => {
    const settings = store.getDeviceSettings(req.params.imei);
    res.json(settings);
});

app.post('/api/admin/update-device-settings', (req, res) => {
    const { imei, settings } = req.body;
    const success = store.updateDeviceSettings(imei, settings);
    if (success) {
        const data = store.getData();
        const device = data.devices.find(d => d.imei === imei);
        io.emit('admin_update');
        if (device) {
            io.emit('settings_updated', { imei, settings, userId: device.ownerId });
        }
    }
    res.json({ success });
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
            
            // Update last seen in store and check geofences
            const alerts = store.updateDeviceLastSeen(parsedData.imei, parsedData);
            
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
            
            // Broadcast Geofence Alerts
            if (alerts && alerts.length > 0) {
                alerts.forEach(alert => {
                    const geoDeviceName = (device && device.name) ? device.name : parsedData.imei;
                    io.emit('geofence_alert', {
                        ownerId: parsedData.ownerId,
                        imei: parsedData.imei,
                        deviceName: geoDeviceName,
                        type: alert.type,
                        geofenceName: alert.geofenceName
                    });

                    const contact = store.getCustomerContact(parsedData.ownerId);
                    if (contact) {
                        // Email
                        if (contact.email) {
                            emailService.sendGeofenceAlert({
                                email: contact.email,
                                customerName: contact.username,
                                deviceName: geoDeviceName,
                                imei: parsedData.imei,
                                type: alert.type,
                                geofenceName: alert.geofenceName,
                                timestamp: parsedData.timestamp
                            });
                        }
                        // SMS (New Production Calls)
                        if (contact.phone) {
                            if (alert.type === 'geofence_enter') {
                                smsService.sendGeofenceEnter(contact.phone, geoDeviceName, alert.geofenceName);
                            } else {
                                smsService.sendGeofenceExit(contact.phone, geoDeviceName, alert.geofenceName);
                            }
                        }
                    }
                });
            }

            // --- PANIC BUTTON INTEGRATION ---
            if (parsedData.packetType === 'EA' || parsedData.event === 'Emergency Alert') {
                console.log(`[ALARM] PANIC BUTTON PRESSED on device: ${parsedData.imei}`);
                const deviceName = (device && device.name) ? device.name : parsedData.imei;
                io.emit('panic_alert', {
                    ownerId: parsedData.ownerId,
                    imei: parsedData.imei,
                    deviceName,
                    lat: parsedData.latitude,
                    lng: parsedData.longitude,
                    time: parsedData.timestamp
                });

                const contact = store.getCustomerContact(parsedData.ownerId);
                if (contact) {
                    // Email
                    if (contact.email) {
                        emailService.sendPanicAlert({
                            email: contact.email,
                            customerName: contact.username,
                            deviceName,
                            imei: parsedData.imei,
                            lat: parsedData.latitude,
                            lng: parsedData.longitude,
                            timestamp: parsedData.timestamp
                        });
                    }
                    // SMS (Production Call)
                    if (contact.phone) {
                        smsService.sendPanic(contact.phone, deviceName);
                    }
                }
            }

            // --- DRIVING BEHAVIOUR EVENTS (HB, HA, RT, TA, BD) ---
            const drivingContact = store.getCustomerContact(parsedData.ownerId);
            const drivingDeviceName = (device && device.name) ? device.name : parsedData.imei;
            if (drivingContact && drivingContact.phone) {
                switch (parsedData.packetType) {
                    case 'HB':
                    case 'HA':
                    case 'RT':
                        smsService.sendSafetyAlert(drivingContact.phone, drivingDeviceName, parsedData.packetType);
                        break;
                    case 'TA':
                        smsService.sendTamperAlert(drivingContact.phone, drivingDeviceName);
                        break;
                }
            }

            
            // Send live log to admin
            io.emit('admin_live_log', {
                time: parsedData.timestamp,
                imei: parsedData.imei,
                hex: parsedData.rawHex,
                status: 'parsed'
            });
        } else {
            console.log(`[TCP] Could not parse data (or not a location packet). Sending raw to UI.`);
            // Send raw data to frontend for debugging
            io.emit('raw_log', {
                time: new Date().toISOString(),
                hex: data.toString('ascii')
            });
            
            // Send live log to admin
            io.emit('admin_live_log', {
                time: new Date().toISOString(),
                imei: 'Unknown',
                hex: data.toString('ascii'),
                status: 'raw'
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
