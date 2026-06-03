const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataFile = process.env.DATA_FILE_PATH ? path.resolve(process.env.DATA_FILE_PATH) : path.join(__dirname, 'data.json');

// Encryption Helpers for Password Storage
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'fleetly-gps-default-key-change-in-prod-2026';
const KEY = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();

function encrypt(text) {
    if (!text) return '';
    try {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', KEY, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return 'enc:' + iv.toString('hex') + ':' + encrypted;
    } catch(e) {
        console.error("[Crypto] Encryption failed:", e.message);
        return text;
    }
}

function decrypt(text) {
    if (!text || !text.startsWith('enc:')) return text;
    try {
        const parts = text.split(':');
        const iv = Buffer.from(parts[1], 'hex');
        const encryptedText = parts[2];
        const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch(e) {
        console.error("[Crypto] Decryption failed:", e.message);
        return text;
    }
}

// Default initial state
const defaultData = {
    users: [
        { id: '1', username: 'admin', password: 'password', role: 'admin' }
    ],
    devices: [], // { imei: string, ownerId: string, name: string }
    requests: [], // { id: string, imei: string, userId: string, status: 'pending'|'approved'|'rejected', timestamp: string }
    subscriptions: [], // { userId: string, validityDays: number, expirationDate: string }
    deviceLastSeen: {}, // Transient data, not strictly needed in JSON, but good for persistence { imei: { timestamp, lat, lng } }
    deviceHistory: {}, // { imei: [points] }
    geofences: [], // { id, userId, name, type: 'polygon'|'circle', points: [[lat,lng]], radius: number }
    kycApplications: [], // { id, userId, applicantType, fullName, docType, docNumber, orgName, gstNumber, authSignatory, status, submittedAt, reviewedAt, rejectReason }
    userSettings: {}, // { userId: { feature: boolean } }
    deviceSettings: {} // { imei: { feature: boolean } }
};

const defaultSettings = {
    odometer: true,
    speedAlert: true,
    ignitionAlert: true,
    geofenceAlert: false,
    powerAlert: false,
    lowBatteryAlert: false,
    panicAlert: true,
    harshAlerts: true,
    towingAlert: true,
    healthStats: false,
    telemetryLogs: true,
    canData: false,
    rs485Data: false,
    uartData: false,
    bleData: false
};

// Spatial Calculation Helpers
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const p1 = lat1 * Math.PI/180;
    const p2 = lat2 * Math.PI/180;
    const dp = (lat2-lat1) * Math.PI/180;
    const dl = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function isPointInPolygon(point, vs) {
    let x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        let xi = vs[i][0], yi = vs[i][1];
        let xj = vs[j][0], yj = vs[j][1];
        let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function readData() {
    try {
        if (!fs.existsSync(dataFile)) {
            writeData(defaultData);
            return defaultData;
        }
        const raw = fs.readFileSync(dataFile, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        console.error("Error reading data.json", e);
        return defaultData;
    }
}

function writeData(data) {
    try {
        const tempFile = dataFile + '.tmp';
        fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
        fs.renameSync(tempFile, dataFile);
    } catch (e) {
        console.error("Error writing data.json", e);
    }
}

module.exports = {
    getData: () => readData(),
    saveData: (data) => writeData(data),

    // Users
    getUser: (username, password) => {
        const data = readData();
        const user = data.users.find(u => u.username === username && decrypt(u.password) === password);
        if (user) {
            return { id: user.id, username: user.username, role: user.role };
        }
        return null;
    },
    getUserById: (id) => {
        const data = readData();
        const user = data.users.find(u => u.id === id);
        if (user) {
            return { id: user.id, username: user.username, role: user.role };
        }
        return null;
    },
    getUserCredentials: (userId) => {
        const data = readData();
        const user = data.users.find(u => u.id === userId);
        if (!user) return null;
        return {
            username: user.username,
            password: decrypt(user.password)
        };
    },
    createUser: (username, password, phone = '', email = '') => {
        const data = readData();
        if (data.users.find(u => u.username === username)) return null; // Exists
        
        const newUser = {
            id: Date.now().toString(),
            username,
            password: encrypt(password),
            role: 'customer',
            phone: phone || '',
            email: email || ''
        };
        data.users.push(newUser);
        
        // Add 10 days trial subscription
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 10);
        data.subscriptions.push({
            userId: newUser.id,
            validityDays: 10,
            expirationDate: expirationDate.toISOString()
        });

        writeData(data);
        return { id: newUser.id, username: newUser.username, role: newUser.role, phone: newUser.phone, email: newUser.email };
    },
    updateUserContact: (userId, phone, email) => {
        const data = readData();
        const user = data.users.find(u => u.id === userId);
        if (!user) return false;
        if (phone !== undefined) user.phone = phone;
        if (email !== undefined) user.email = email;
        writeData(data);
        return true;
    },
    getCustomerContact: (userId) => {
        const data = readData();
        const user = data.users.find(u => u.id === userId);
        if (!user) return null;
        return { username: user.username, phone: user.phone || '', email: user.email || '' };
    },
    getAllCustomers: () => {
        const data = readData();
        const customers = data.users.filter(u => u.role === 'customer').map(u => ({
            id: u.id,
            username: u.username,
            phone: u.phone || '',
            email: u.email || '',
            subscription: data.subscriptions.find(s => s.userId === u.id)
        }));
        return customers;
    },

    // Admin Management
    approveDeviceRequest: (imei, userId) => {
        const data = readData();
        // Remove from requests
        data.deviceRequests = (data.deviceRequests || []).filter(r => r.imei !== imei);
        
        // Add to devices
        if (!data.devices.find(d => d.imei === imei)) {
            data.devices.push({
                imei,
                ownerId: userId,
                name: 'New Asset'
            });
        }
        writeData(data);
        return true;
    },
    deleteCustomer: (userId) => {
        const data = readData();
        data.users = data.users.filter(u => u.id !== userId);
        data.devices = data.devices.filter(d => d.ownerId !== userId);
        data.subscriptions = data.subscriptions.filter(s => s.userId !== userId);
        writeData(data);
        return true;
    },
    updateContact: (userId, phone, email) => {
        const data = readData();
        const user = data.users.find(u => u.id === userId);
        if (user) {
            user.phone = phone;
            user.email = email;
            writeData(data);
            return true;
        }
        return false;
    },
    addSubscriptionDays: (userId, days) => {
        const data = readData();
        let sub = data.subscriptions.find(s => s.userId === userId);
        if (!sub) {
            sub = { userId, expirationDate: new Date().toISOString() };
            data.subscriptions.push(sub);
        }
        const currentExp = new Date(sub.expirationDate);
        const baseDate = currentExp > new Date() ? currentExp : new Date();
        baseDate.setDate(baseDate.getDate() + days);
        sub.expirationDate = baseDate.toISOString();
        writeData(data);
        return true;
    },

    getPendingRequests: () => {
        const data = readData();
        const pending = data.requests.filter(r => r.status === 'pending');
        // Attach last seen info
        return pending.map(r => ({
            ...r,
            lastSeen: data.deviceLastSeen[r.imei] || null,
            username: data.users.find(u => u.id === r.userId)?.username
        }));
    },
    approveRequest: (requestId) => {
        const data = readData();
        const req = data.requests.find(r => r.id === requestId);
        if (!req || req.status !== 'pending') return false;

        req.status = 'approved';
        data.devices.push({
            imei: req.imei,
            ownerId: req.userId,
            name: `Device ${req.imei.slice(-4)}`
        });
        writeData(data);
        return true;
    },
    rejectRequest: (requestId) => {
        const data = readData();
        const initialLength = data.requests.length;
        data.requests = data.requests.filter(r => r.id !== requestId);
        if (data.requests.length < initialLength) {
            writeData(data);
            return true;
        }
        return false;
    },
    getCustomerDevices: (userId) => {
        const data = readData();
        return data.devices.filter(d => d.ownerId === userId);
    },
    togglePinDevice: (userId, imei) => {
        imei = imei.trim();
        const data = readData();
        const device = data.devices.find(d => d.ownerId === userId && d.imei === imei);
        if (device) {
            device.pinned = !device.pinned;
            writeData(data);
            return device.pinned;
        }
        return false;
    },
    getCustomerSubscription: (userId) => {
        const data = readData();
        const sub = data.subscriptions.find(s => s.userId === userId);
        if (sub) {
            const expDate = new Date(sub.expirationDate);
            sub.daysLeft = Math.ceil((expDate - new Date()) / (1000 * 60 * 60 * 24));
            if (sub.daysLeft < 0) sub.daysLeft = 0;
        }
        return sub;
    },
    
    // Tracking
    updateDeviceLastSeen: (imei, locationData) => {
        const data = readData();
        if (!data.deviceLastSeen) data.deviceLastSeen = {};
        if (!data.deviceHistory) data.deviceHistory = {};
        
        const point = {
            timestamp: locationData.timestamp,
            latitude: locationData.latitude,
            longitude: locationData.longitude,
            speed: locationData.speed,
            heading: locationData.heading,
            satellites: locationData.satellites,
            gpsValid: locationData.gpsValid,
            battery: locationData.battery,
            ignition: locationData.ignition,
            packetType: locationData.packetType,
            event: locationData.event,
            odometer: locationData.odometer || 0,
            rawHex: locationData.rawHex || ''
        };
        
        data.deviceLastSeen[imei] = point;
        
        if(!data.deviceHistory[imei]) data.deviceHistory[imei] = [];
        data.deviceHistory[imei].push(point);
        if(data.deviceHistory[imei].length > 500) data.deviceHistory[imei].shift();
        
        writeData(data);
        return []; // No alerts generated
    },
    getHistory: (imei) => {
        const data = readData();
        return data.deviceHistory ? data.deviceHistory[imei] || [] : [];
    },
    
    // Geofences
    getGeofences: (userId) => {
        const data = readData();
        return (data.geofences || []).filter(g => g.userId === userId);
    },
    addGeofence: (geofence) => {
        const data = readData();
        if (!data.geofences) data.geofences = [];
        geofence.id = Date.now().toString();
        data.geofences.push(geofence);
        writeData(data);
        return geofence;
    },
    deleteGeofence: (id) => {
        const data = readData();
        if (!data.geofences) return false;
        const initialLength = data.geofences.length;
        data.geofences = data.geofences.filter(g => g.id !== id);
        writeData(data);
        return data.geofences.length < initialLength;
    },
    updateGeofence: (id, updates) => {
        const data = readData();
        if (!data.geofences) return false;
        const gf = data.geofences.find(g => g.id === id);
        if (gf) {
            Object.assign(gf, updates);
            writeData(data);
            return true;
        }
        return false;
    },
    
    updateSubscriptionValidity: (userId, extraDays) => {
         const data = readData();
         const sub = data.subscriptions.find(s => s.userId === userId);
         if(sub) {
             const currentDate = new Date(sub.expirationDate);
             currentDate.setDate(currentDate.getDate() + parseInt(extraDays));
             sub.expirationDate = currentDate.toISOString();
             sub.validityDays += parseInt(extraDays);
             writeData(data);
             return true;
         }
         return false;
    },

    // KYC Applications
    createKycApplication: (appData) => {
        const data = readData();
        if (!data.kycApplications) data.kycApplications = [];
        // Replace existing application for same user if pending/rejected
        data.kycApplications = data.kycApplications.filter(k => !(k.userId === appData.userId && k.status !== 'verified'));
        const kyc = {
            id: Date.now().toString(),
            ...appData,
            status: 'under_review',
            submittedAt: new Date().toISOString(),
            reviewedAt: null,
            rejectReason: null
        };
        data.kycApplications.push(kyc);
        writeData(data);
        return kyc;
    },
    getKycApplications: () => {
        const data = readData();
        if (!data.kycApplications) return [];
        return data.kycApplications.map(k => ({
            ...k,
            username: data.users.find(u => u.id === k.userId)?.username || 'Unknown'
        }));
    },
    getKycByUserId: (userId) => {
        const data = readData();
        if (!data.kycApplications) return null;
        return data.kycApplications.find(k => k.userId === userId) || null;
    },
    updateKycStatus: (kycId, status, rejectReason = null) => {
        const data = readData();
        if (!data.kycApplications) return false;
        const kyc = data.kycApplications.find(k => k.id === kycId);
        if (!kyc) return false;
        kyc.status = status;
        kyc.reviewedAt = new Date().toISOString();
        if (rejectReason) kyc.rejectReason = rejectReason;
        writeData(data);
        return true;
    },

    // Device Settings / Features Toggles (IMEI based)
    getDeviceSettings: (imei) => {
        const data = readData();
        if (!data.deviceSettings) data.deviceSettings = {};
        if (!data.deviceSettings[imei]) {
            return defaultSettings;
        }
        return { ...defaultSettings, ...data.deviceSettings[imei] };
    },
    updateDeviceSettings: (imei, settings) => {
        const data = readData();
        if (!data.deviceSettings) data.deviceSettings = {};
        data.deviceSettings[imei] = { 
            ...(data.deviceSettings[imei] || defaultSettings),
            ...settings 
        };
        writeData(data);
        return true;
    },
    // Keep userSettings for legacy/global preferences if needed
    getUserSettings: (userId) => {
        const data = readData();
        if (!data.userSettings) data.userSettings = {};
        return { ...defaultSettings, ...(data.userSettings[userId] || {}) };
    },
    updateUserSettings: (userId, settings) => {
        const data = readData();
        if (!data.userSettings) data.userSettings = {};
        data.userSettings[userId] = {
            ...(data.userSettings[userId] || defaultSettings),
            ...settings
        };
        writeData(data);
        return true;
    },

    // Reset / update password
    resetPassword: (userId, newPassword) => {
        const data = readData();
        const user = data.users.find(u => u.id === userId);
        if (!user) return false;
        user.password = encrypt(newPassword);
        writeData(data);
        return true;
    }
};
