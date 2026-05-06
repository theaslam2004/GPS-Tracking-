const fs = require('fs');
const path = require('path');

const dataFile = path.join(__dirname, 'data.json');

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
    geofences: [] // { id, userId, name, type: 'polygon'|'circle', points: [[lat,lng]], radius: number }
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
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
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
        return data.users.find(u => u.username === username && u.password === password);
    },
    getUserById: (id) => {
        const data = readData();
        return data.users.find(u => u.id === id);
    },
    createUser: (username, password) => {
        const data = readData();
        if (data.users.find(u => u.username === username)) return null; // Exists
        
        const newUser = {
            id: Date.now().toString(),
            username,
            password,
            role: 'customer'
        };
        data.users.push(newUser);
        
        // Add 30 days dummy subscription
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 30);
        data.subscriptions.push({
            userId: newUser.id,
            validityDays: 30,
            expirationDate: expirationDate.toISOString()
        });

        writeData(data);
        return newUser;
    },
    getAllCustomers: () => {
        const data = readData();
        const customers = data.users.filter(u => u.role === 'customer').map(u => ({
            id: u.id,
            username: u.username,
            subscription: data.subscriptions.find(s => s.userId === u.id)
        }));
        return customers;
    },

    // Devices & Requests
    requestDevice: (userId, imei) => {
        imei = imei.trim();
        const data = readData();
        // Check if already owned
        if (data.devices.find(d => d.imei === imei)) return { error: 'Device already registered.' };
        // Check if already requested
        if (data.requests.find(r => r.imei === imei && r.status === 'pending')) return { error: 'Device approval is already pending.' };

        const req = {
            id: Date.now().toString(),
            imei,
            userId,
            status: 'pending',
            timestamp: new Date().toISOString()
        };
        data.requests.push(req);
        writeData(data);
        return req;
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
        if (!data.geofences) data.geofences = [];
        
        // Geofence Checking
        const ownerId = data.devices.find(d => d.imei === imei)?.ownerId;
        const alerts = [];
        
        if (ownerId && locationData.latitude && locationData.longitude) {
            const userGeofences = data.geofences.filter(g => g.userId === ownerId);
            const pt = [locationData.latitude, locationData.longitude];
            
            const previousPoint = data.deviceLastSeen[imei];
            
            userGeofences.forEach(gf => {
                let isCurrentlyInside = false;
                if (gf.type === 'circle') {
                    isCurrentlyInside = getDistance(pt[0], pt[1], gf.points[0][0], gf.points[0][1]) <= gf.radius;
                } else if (gf.type === 'polygon') {
                    isCurrentlyInside = isPointInPolygon(pt, gf.points);
                }
                
                // If we have previous data, check for entry/exit
                if (previousPoint) {
                    let wasInside = false;
                    const prevPt = [previousPoint.latitude, previousPoint.longitude];
                    if (gf.type === 'circle') {
                        wasInside = getDistance(prevPt[0], prevPt[1], gf.points[0][0], gf.points[0][1]) <= gf.radius;
                    } else if (gf.type === 'polygon') {
                        wasInside = isPointInPolygon(prevPt, gf.points);
                    }
                    
                    if (isCurrentlyInside && !wasInside) {
                        alerts.push({ type: 'geofence_enter', geofenceName: gf.name });
                    } else if (!isCurrentlyInside && wasInside) {
                        alerts.push({ type: 'geofence_exit', geofenceName: gf.name });
                    }
                }
            });
        }
        
        const point = {
            timestamp: locationData.timestamp,
            latitude: locationData.latitude,
            longitude: locationData.longitude,
            speed: locationData.speed,
            odometer: locationData.odometer || 0,
            rawHex: locationData.rawHex || ''
        };
        
        data.deviceLastSeen[imei] = point;
        
        if(!data.deviceHistory[imei]) data.deviceHistory[imei] = [];
        data.deviceHistory[imei].push(point);
        if(data.deviceHistory[imei].length > 500) data.deviceHistory[imei].shift();
        
        writeData(data);
        return alerts;
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
    }
};
