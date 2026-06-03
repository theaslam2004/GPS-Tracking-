const net = require('net');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const parseDeviceData = require('./parser');
const store = require('./store');
const emailService = require('./emailService');
const smsService = require('./smsService');
const session = require('express-session');
require('dotenv').config();

const TCP_PORT = process.env.TCP_PORT ? parseInt(process.env.TCP_PORT) : 8080;
const HTTP_PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// Setup Express and HTTP server for the Frontend
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Setup Express Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'fleetly-gps-session-super-secure-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if running over HTTPS in production
        maxAge: 24 * 60 * 60 * 1000 // 24 Hours
    }
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Authentication Middlewares
const requireLogin = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    res.status(401).json({ success: false, error: 'Unauthorized: Login required' });
};

const requireAdmin = (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    res.status(403).json({ success: false, error: 'Forbidden: Admin access required' });
};

// API: Auth Check
app.get('/api/auth/me', (req, res) => {
    if (req.session && req.session.user) {
        res.json({ success: true, user: req.session.user });
    } else {
        res.status(401).json({ success: false, error: 'Not authenticated' });
    }
});

// API: Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(`[HTTP] Login attempt for user: ${username}`);
    try {
        const user = await store.getUser(username, password);
        if (user) {
            console.log(`[HTTP] Login successful for: ${username}`);
            req.session.user = {
                id: user.id,
                username: user.username,
                role: user.role
            };
            res.json({ success: true, user: req.session.user });
        } else {
            console.log(`[HTTP] Login failed for: ${username}`);
            res.json({ success: false, error: 'Invalid credentials' });
        }
    } catch(e) {
        console.error('[HTTP] Login Error:', e);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// API: Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ success: false, error: 'Could not log out' });
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// ── CUSTOMER API ENDPOINTS ──

app.post('/api/customer/request-device', requireLogin, async (req, res) => {
    const { userId, imei } = req.body;
    const result = await store.requestDevice(userId, imei);
    if (result.error) {
        res.json({ success: false, error: result.error });
    } else {
        io.emit('admin_update');
        res.json({ success: true, request: result });
    }
});

app.post('/api/customer/pin-device', requireLogin, async (req, res) => {
    const { userId, imei } = req.body;
    const pinned = await store.togglePinDevice(userId, imei);
    res.json({ success: true, pinned });
});

app.get('/api/customer/data', requireLogin, async (req, res) => {
    const userId = req.query.userId;
    const devices = await store.getCustomerDevices(userId);
    const lastSeen = {};
    const dataStore = await store.getData();
    const allLastSeen = dataStore.deviceLastSeen || {};
    devices.forEach(d => {
        if (allLastSeen[d.imei]) {
            lastSeen[d.imei] = allLastSeen[d.imei];
        }
    });

    const subscription = await store.getCustomerSubscription(userId);
    const pricing = await store.getSystemSettings();

    res.json({
        devices,
        subscription,
        lastSeen,
        deviceCount: devices.length,
        pricing
    });
});

app.get('/api/customer/history', requireLogin, async (req, res) => {
    const imei = req.query.imei;
    res.json({
        history: await store.getHistory(imei)
    });
});

app.get('/api/customer/settings', requireLogin, async (req, res) => {
    const userId = req.query.userId;
    const devices = await store.getCustomerDevices(userId);
    const settingsMap = {};
    for (let d of devices) {
        settingsMap[d.imei] = await store.getDeviceSettings(d.imei);
    }
    res.json(settingsMap);
});

// API: Geofences
app.get('/api/customer/geofences', requireLogin, async (req, res) => {
    const userId = req.query.userId;
    res.json(await store.getGeofences(userId));
});

app.post('/api/customer/geofence', requireLogin, async (req, res) => {
    res.json(await store.addGeofence(req.body));
});

app.post('/api/customer/geofence/update/:id', requireLogin, async (req, res) => {
    res.json({ success: await store.updateGeofence(req.params.id, req.body) });
});

app.delete('/api/customer/geofence/:id', requireLogin, async (req, res) => {
    res.json({ success: await store.deleteGeofence(req.params.id) });
});

// API: Export Excel / CSV
app.get('/api/export/devices', requireLogin, async (req, res) => {
    const userId = req.query.userId;
    const role = req.query.role;
    
    let devices = [];
    if (role === 'admin' && req.session.user.role === 'admin') {
        const dataStore = await store.getData();
        devices = dataStore.devices;
    } else {
        devices = await store.getCustomerDevices(userId);
    }
    
    const dataStore = await store.getData();
    const lastSeen = dataStore.deviceLastSeen;
    
    let csv = "IMEI,Name,OwnerID,LastLatitude,LastLongitude,LastSpeed,LastTimestamp\n";
    devices.forEach(d => {
        const ls = lastSeen[d.imei] || {};
        csv += `${d.imei},${d.name},${d.ownerId},${ls.latitude || ''},${ls.longitude || ''},${ls.speed || ''},${ls.timestamp || ''}\n`;
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="devices_export.csv"');
    res.send(csv);
});

app.get('/api/export/history/:imei', requireLogin, async (req, res) => {
    const imei = req.params.imei;
    const history = await store.getHistory(imei);
    
    let csv = "Timestamp,Latitude,Longitude,Speed,Odometer,RawData\n";
    history.forEach(pt => {
        csv += `${pt.timestamp},${pt.latitude},${pt.longitude},${pt.speed},${pt.odometer},"${pt.rawHex}"\n`;
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="history_${imei}.csv"`);
    res.send(csv);
});

// ── ADMIN API ENDPOINTS ──

app.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
    const dataStore = await store.getData();
    const payments = await store.getPayments();
    const totalIncome = await store.getTotalIncome();
    const pricing = await store.getSystemSettings();

    // Compute plan breakdown stats
    const customers = await store.getAllCustomers();
    const planStats = { Trial: 0, Basic: 0, Standard: 0, Premium: 0, Enterprise: 0 };
    customers.forEach(c => {
        const plan = (c.subscription && c.subscription.planName) || 'Trial';
        if (planStats[plan] !== undefined) planStats[plan]++;
    });

    res.json({
        customers,
        allDevices: dataStore.devices,
        requests: dataStore.deviceRequests,
        lastSeen: dataStore.deviceLastSeen || {},
        payments,
        totalIncome,
        pricing,
        planStats
    });
});

app.post('/api/admin/create-customer', requireAdmin, async (req, res) => {
    const { username, password, phone, email } = req.body;
    try {
        const user = await store.createUser(username, password, phone, email);
        if (user) {
            io.emit('admin_update');
            res.json({ success: true, user });
        } else {
            res.json({ success: false, error: 'Username already exists' });
        }
    } catch (e) {
        console.error('[HTTP] Create Customer Error:', e);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.post('/api/admin/approve-request', requireAdmin, async (req, res) => {
    const { imei, ownerId } = req.body;
    const success = await store.approveDeviceRequest(imei, ownerId);
    if (success) {
        io.emit('admin_update');
        io.emit('customer_update', { userId: ownerId });
    }
    res.json({ success });
});

app.delete('/api/admin/delete-customer/:userId', requireAdmin, async (req, res) => {
    const success = await store.deleteCustomer(req.params.userId);
    if (success) io.emit('admin_update');
    res.json({ success });
});

app.post('/api/admin/update-contact', requireAdmin, async (req, res) => {
    const { userId, phone, email } = req.body;
    const success = await store.updateContact(userId, phone, email);
    if (success) io.emit('admin_update');
    res.json({ success });
});

app.post('/api/admin/update-validity', requireAdmin, async (req, res) => {
    const { userId, days } = req.body;
    const success = await store.addSubscriptionDays(userId, parseInt(days));
    if (success) io.emit('admin_update');
    res.json({ success });
});

app.get('/api/admin/customer-settings/:userId', requireAdmin, async (req, res) => {
    const settings = await store.getUserSettings(req.params.userId);
    res.json(settings);
});

app.post('/api/admin/update-customer-settings', requireAdmin, async (req, res) => {
    const { userId, settings } = req.body;
    await store.updateUserSettings(userId, settings);
    
    // Bulk update all devices for this user
    const devices = await store.getCustomerDevices(userId);
    for (let d of devices) {
        await store.updateDeviceSettings(d.imei, settings);
        io.emit('settings_updated', { imei: d.imei, settings, userId });
    }
    io.emit('admin_update');
    res.json({ success: true });
});

app.get('/api/admin/device-settings/:imei', requireAdmin, async (req, res) => {
    const settings = await store.getDeviceSettings(req.params.imei);
    res.json(settings);
});

app.post('/api/admin/update-device-settings', requireAdmin, async (req, res) => {
    const { imei, settings } = req.body;
    const success = await store.updateDeviceSettings(imei, settings);
    if (success) {
        const dataStore = await store.getData();
        const device = dataStore.devices.find(d => d.imei === imei);
        io.emit('admin_update');
        if (device) {
            io.emit('settings_updated', { imei, settings, userId: device.ownerId });
        }
    }
    res.json({ success });
});

app.get('/api/admin/get-credentials/:userId', requireAdmin, async (req, res) => {
    const userId = req.params.userId;
    const creds = await store.getUserCredentials(userId);
    if (creds) {
        res.json({ success: true, username: creds.username, password: creds.password });
    } else {
        res.json({ success: false, error: 'User not found' });
    }
});

app.post('/api/admin/reset-password', requireAdmin, async (req, res) => {
    const { userId, newPassword } = req.body;
    const success = await store.resetPassword(userId, newPassword);
    res.json({ success });
});

// ── SYSTEM PRICING & SUBSCRIPTIONS API ──

// GET active pricing for customer
app.get('/api/customer/pricing', requireLogin, async (req, res) => {
    try {
        const pricing = await store.getSystemSettings();
        res.json({ success: true, pricing });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to load pricing configurations.' });
    }
});

// Customer Upgrade Plan (Simulated payment check-out)
app.post('/api/customer/upgrade-plan', requireLogin, async (req, res) => {
    const { userId, planName } = req.body;
    if (req.session.user.id !== userId) {
        return res.status(403).json({ success: false, error: 'Forbidden: Access denied' });
    }

    try {
        const pricing = await store.getSystemSettings();
        const planConfig = pricing[planName];
        if (!planConfig) {
            return res.status(400).json({ success: false, error: 'Invalid subscription plan selected.' });
        }

        const pricePaid = planConfig.price;
        const result = await store.updateCustomerPlan(userId, planName, pricePaid);

        if (result) {
            io.emit('admin_update');
            io.emit('customer_update', { userId });
            res.json({ success: true, subscription: result });
        } else {
            res.status(500).json({ success: false, error: 'Plan upgrade failed.' });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to complete transaction.' });
    }
});

// GET System Pricing configurations (Admin only)
app.get('/api/admin/pricing', requireAdmin, async (req, res) => {
    try {
        const pricing = await store.getSystemSettings();
        res.json({ success: true, pricing });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to fetch settings.' });
    }
});

// POST Update System Pricing / Plan Configurations (Admin only)
app.post('/api/admin/pricing', requireAdmin, async (req, res) => {
    const { plans } = req.body;
    try {
        const success = await store.updateSystemSettings(plans);
        if (success) {
            io.emit('admin_update');
            res.json({ success: true });
        } else {
            res.json({ success: false, error: 'Failed to save settings.' });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to update system configurations.' });
    }
});

// Admin Update Customer's plan directly
app.post('/api/admin/update-plan', requireAdmin, async (req, res) => {
    const { userId, planName, pricePaid, deviceLimit } = req.body;
    try {
        const result = await store.updateCustomerPlan(userId, planName, parseFloat(pricePaid || 0), deviceLimit);
        if (result) {
            io.emit('admin_update');
            io.emit('customer_update', { userId });
            res.json({ success: true, subscription: result });
        } else {
            res.json({ success: false, error: 'Could not update user plan.' });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
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

    socket.on('data', async (data) => {
        console.log(`[TCP] Received raw data from ${clientAddress} (${data.length} bytes)`);
        
        // Pass the raw buffer to our parser
        const parsedData = parseDeviceData(data);
        
        if (parsedData) {
            console.log(`[TCP] Parsed Data:`, parsedData);
            
            // Update last seen in store
            const alerts = await store.updateDeviceLastSeen(parsedData.imei, parsedData);
            
            // Identify owner
            const dataStore = await store.getData();
            const devices = dataStore.devices;
            const device = devices.find(d => d.imei === parsedData.imei);
            if (device) {
                parsedData.ownerId = device.ownerId;
                
                // Subscription Lockout Check
                const sub = await store.getCustomerSubscription(device.ownerId);
                if (sub && sub.daysLeft <= 0) {
                    console.log(`[TCP] Blocked data for ${parsedData.imei} due to expired subscription.`);
                    io.emit('subscription_expired', { ownerId: device.ownerId });
                    return;
                }
            }

            // Broadcast the parsed data to all connected web clients
            io.emit('device_data', parsedData);
            
            // Broadcast Geofence Alerts
            if (alerts && alerts.length > 0) {
                alerts.forEach(async (alert) => {
                    const geoDeviceName = (device && device.name) ? device.name : parsedData.imei;
                    io.emit('geofence_alert', {
                        ownerId: parsedData.ownerId,
                        imei: parsedData.imei,
                        deviceName: geoDeviceName,
                        type: alert.type,
                        geofenceName: alert.geofenceName
                    });

                    const contact = await store.getCustomerContact(parsedData.ownerId);
                    if (contact) {
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

                const contact = await store.getCustomerContact(parsedData.ownerId);
                if (contact) {
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
                    if (contact.phone) {
                        smsService.sendPanic(contact.phone, deviceName);
                    }
                }
            }

            // --- DRIVING BEHAVIOUR EVENTS (HB, HA, RT, TA, BD) ---
            const drivingContact = await store.getCustomerContact(parsedData.ownerId);
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
            io.emit('raw_log', {
                time: new Date().toISOString(),
                hex: data.toString('ascii')
            });
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
