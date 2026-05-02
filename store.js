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
    deviceHistory: {} // { imei: [points] }
};

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
    getCustomerDevices: (userId) => {
        const data = readData();
        return data.devices.filter(d => d.ownerId === userId);
    },
    togglePinDevice: (userId, imei) => {
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
            odometer: locationData.odometer || 0,
            rawHex: locationData.rawHex || ''
        };
        
        data.deviceLastSeen[imei] = point;
        
        if(!data.deviceHistory[imei]) data.deviceHistory[imei] = [];
        data.deviceHistory[imei].push(point);
        if(data.deviceHistory[imei].length > 500) data.deviceHistory[imei].shift();
        
        writeData(data);
    },
    getHistory: (imei) => {
        const data = readData();
        return data.deviceHistory ? data.deviceHistory[imei] || [] : [];
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
