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
    devices: [], // { imei: string, ownerId: string, name: string, driverName: string, vehicleProfile: string, initialOdometer: number }
    deviceRequests: [], // { id: string, imei: string, userId: string, status: 'pending'|'approved'|'rejected', timestamp: string }
    subscriptions: [], // { userId: string, validityDays: number, expirationDate: string, planName: string, deviceLimit: number, pricePaid: number }
    deviceLastSeen: {}, // { imei: { timestamp, lat, lng, speed, heading, satellites, gpsValid, battery, ignition, packetType, event, odometer, rawHex, status, ignitionOnTime, ignitionOffTime, powerSource, voltage } }
    deviceHistory: {}, // { imei: [points] }
    geofences: [], // { id, userId, name, type, points, radius }
    kycApplications: [], // KYC apps
    userSettings: {}, 
    deviceSettings: {},
    payments: [],
    sharedLinks: [],
    systemSettings: {
        'Trial': { name: 'Trial', price: 0, deviceLimit: 100, validityDays: 10 },
        'Basic': { name: 'Basic', price: 99, deviceLimit: 2, validityDays: 30 },
        'Standard': { name: 'Standard', price: 199, deviceLimit: 5, validityDays: 30 },
        'Premium': { name: 'Premium', price: 399, deviceLimit: 15, validityDays: 30 },
        'Enterprise': { name: 'Enterprise', price: 999, deviceLimit: 500, validityDays: 30 }
    }
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

function readData() {
    try {
        if (!fs.existsSync(dataFile)) {
            writeData(defaultData);
            return defaultData;
        }
        const raw = fs.readFileSync(dataFile, 'utf8');
        const parsed = JSON.parse(raw);
        // Guarantee array structures exist
        if (!parsed.users) parsed.users = defaultData.users;
        if (!parsed.devices) parsed.devices = [];
        if (!parsed.deviceRequests) parsed.deviceRequests = [];
        if (!parsed.subscriptions) parsed.subscriptions = [];
        if (!parsed.deviceLastSeen) parsed.deviceLastSeen = {};
        if (!parsed.deviceHistory) parsed.deviceHistory = {};
        if (!parsed.geofences) parsed.geofences = [];
        if (!parsed.kycApplications) parsed.kycApplications = [];
        if (!parsed.userSettings) parsed.userSettings = {};
        if (!parsed.deviceSettings) parsed.deviceSettings = {};
        if (!parsed.payments) parsed.payments = [];
        if (!parsed.sharedLinks) parsed.sharedLinks = [];
        if (!parsed.systemSettings) parsed.systemSettings = defaultData.systemSettings;
        return parsed;
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

// Seeding Default Admin on import
function bootstrapAdmin() {
    const data = readData();
    const adminExists = data.users.find(u => u.username === 'admin');
    if (!adminExists) {
        data.users.push({
            id: '1',
            username: 'admin',
            password: encrypt('password'),
            role: 'admin'
        });
        writeData(data);
        console.log('[Database] Default admin seeded.');
    }
}
bootstrapAdmin();

module.exports = {
    getData: async () => {
        const data = readData();
        return {
            devices: data.devices,
            deviceLastSeen: data.deviceLastSeen,
            deviceRequests: data.deviceRequests
        };
    },

    // Users
    getUser: async (username, password) => {
        const data = readData();
        const user = data.users.find(u => u.username === username && decrypt(u.password) === password);
        if (user) {
            return { id: user.id, username: user.username, role: user.role };
        }
        return null;
    },
    getUserById: async (id) => {
        const data = readData();
        const user = data.users.find(u => u.id === id);
        if (user) {
            return { id: user.id, username: user.username, role: user.role };
        }
        return null;
    },
    getUserCredentials: async (userId) => {
        const data = readData();
        const user = data.users.find(u => u.id === userId);
        if (!user) return null;
        return {
            username: user.username,
            password: 'Protected (Bcrypt - use Reset Form)'
        };
    },
    createUser: async (username, password, phone = '', email = '') => {
        const data = readData();
        if (data.users.find(u => u.username === username)) return null;

        const userId = Date.now().toString();
        const newUser = {
            id: userId,
            username,
            password: encrypt(password),
            role: 'customer',
            phone: phone || '',
            email: email || ''
        };
        data.users.push(newUser);

        const pricing = data.systemSettings || defaultData.systemSettings;
        const trialPlan = pricing['Trial'] || { validityDays: 10, deviceLimit: 100 };
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + (trialPlan.validityDays || 10));

        data.subscriptions.push({
            userId,
            planName: 'Trial',
            deviceLimit: trialPlan.deviceLimit || 100,
            pricePaid: 0,
            validityDays: trialPlan.validityDays || 10,
            expirationDate: expirationDate.toISOString()
        });

        writeData(data);
        return { id: newUser.id, username: newUser.username, role: newUser.role, phone: newUser.phone, email: newUser.email };
    },
    updateUserContact: async (userId, phone, email) => {
        const data = readData();
        const user = data.users.find(u => u.id === userId);
        if (!user) return false;
        if (phone !== undefined) user.phone = phone;
        if (email !== undefined) user.email = email;
        writeData(data);
        return true;
    },
    getCustomerContact: async (userId) => {
        const data = readData();
        const user = data.users.find(u => u.id === userId);
        if (!user) return null;
        return { username: user.username, phone: user.phone || '', email: user.email || '' };
    },
    getAllCustomers: async () => {
        const data = readData();
        return data.users.filter(u => u.role === 'customer').map(u => {
            const sub = data.subscriptions.find(s => s.userId === u.id);
            let formattedSub = null;
            if (sub) {
                const expDate = new Date(sub.expirationDate);
                const daysLeft = Math.max(0, Math.ceil((expDate - new Date()) / (1000 * 60 * 60 * 24)));
                formattedSub = {
                    userId: sub.userId,
                    validityDays: sub.validityDays,
                    expirationDate: sub.expirationDate,
                    daysLeft,
                    planName: sub.planName || 'Trial',
                    deviceLimit: sub.deviceLimit || 1,
                    pricePaid: sub.pricePaid || 0
                };
            }
            return {
                id: u.id,
                username: u.username,
                phone: u.phone || '',
                email: u.email || '',
                subscription: formattedSub
            };
        });
    },

    // Registration & Device Ops
    requestDevice: async (userId, imei) => {
        const data = readData();
        const user = data.users.find(u => u.id === userId);
        if (!user) return { error: 'User not found' };

        const deviceExists = data.devices.find(d => d.imei === imei);
        if (deviceExists && deviceExists.ownerId === userId) {
            return { error: 'Device is already registered to your account' };
        }

        const pendingRequest = data.deviceRequests.find(r => r.imei === imei && r.status === 'pending');
        if (pendingRequest) return { error: 'A request is already pending for this device' };

        const activeCount = data.devices.filter(d => d.ownerId === userId).length;
        const pendingCount = data.deviceRequests.filter(r => r.userId === userId && r.status === 'pending').length;

        const sub = data.subscriptions.find(s => s.userId === userId);
        const limit = sub ? (sub.deviceLimit || 100) : 100;

        if (activeCount + pendingCount >= limit) {
            return { error: `Device limit reached. Your current plan allows up to ${limit} device(s). Please contact admin to increase your limit.` };
        }

        const req = {
            id: Date.now().toString(),
            imei,
            userId,
            status: 'pending',
            timestamp: new Date().toISOString()
        };
        data.deviceRequests.push(req);
        writeData(data);
        return req;
    },
    rejectDeviceRequest: async (imei) => {
        const data = readData();
        const req = data.deviceRequests.find(r => r.imei === imei && r.status === 'pending');
        if (req) {
            req.status = 'rejected';
            req.timestamp = new Date().toISOString();
            writeData(data);
            return true;
        }
        return false;
    },
    approveDeviceRequest: async (imei, userId) => {
        const data = readData();
        const req = data.deviceRequests.find(r => r.imei === imei && r.status === 'pending');
        if (req) {
            req.status = 'approved';
            req.userId = userId;
            req.timestamp = new Date().toISOString();
        } else {
            data.deviceRequests.push({
                id: Date.now().toString(),
                imei,
                userId,
                status: 'approved',
                timestamp: new Date().toISOString()
            });
        }
        const existingDevice = data.devices.find(d => d.imei === imei);
        if (existingDevice) {
            existingDevice.ownerId = userId;
        } else {
            data.devices.push({
                imei,
                ownerId: userId,
                name: 'New Asset',
                driverName: 'Unassigned',
                vehicleProfile: 'standard',
                initialOdometer: 0
            });
        }
        writeData(data);
        return true;
    },
    deleteCustomer: async (userId) => {
        const data = readData();
        data.users = data.users.filter(u => u.id !== userId);
        data.devices = data.devices.filter(d => d.ownerId !== userId);
        data.subscriptions = data.subscriptions.filter(s => s.userId !== userId);
        data.geofences = data.geofences.filter(g => g.userId !== userId);
        data.kycApplications = data.kycApplications.filter(k => k.userId !== userId);
        writeData(data);
        return true;
    },
    updateContact: async (userId, phone, email) => {
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
    addSubscriptionDays: async (userId, days) => {
        const data = readData();
        let sub = data.subscriptions.find(s => s.userId === userId);
        if (!sub) {
            const expDate = new Date();
            expDate.setDate(expDate.getDate() + days);
            sub = {
                userId,
                planName: 'Trial',
                deviceLimit: 100,
                pricePaid: 0,
                validityDays: days,
                expirationDate: expDate.toISOString()
            };
            data.subscriptions.push(sub);
        } else {
            const currentExp = new Date(sub.expirationDate);
            const baseDate = currentExp > new Date() ? currentExp : new Date();
            baseDate.setDate(baseDate.getDate() + days);
            sub.expirationDate = baseDate.toISOString();
            sub.validityDays = (sub.validityDays || 0) + days;
        }
        writeData(data);
        return true;
    },
    getCustomerDevices: async (userId) => {
        const data = readData();
        return data.devices.filter(d => d.ownerId === userId);
    },
    togglePinDevice: async (userId, imei) => {
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
    getCustomerSubscription: async (userId) => {
        const data = readData();
        const sub = data.subscriptions.find(s => s.userId === userId);
        if (sub) {
            const expDate = new Date(sub.expirationDate);
            const daysLeft = Math.max(0, Math.ceil((expDate - new Date()) / (1000 * 60 * 60 * 24)));
            return {
                userId: sub.userId,
                validityDays: sub.validityDays,
                expirationDate: sub.expirationDate,
                daysLeft
            };
        }
        return null;
    },

    // Telematics & LastSeen Updates (Advanced State Machine)
    updateDeviceLastSeen: async (imei, locationData) => {
        const data = readData();
        const dev = data.devices.find(d => d.imei === imei);
        const initialOdo = dev ? (dev.initialOdometer || 0) : 0;
        const prevRecord = data.deviceLastSeen[imei];

        let status = 'offline';
        let ignitionOnTime = prevRecord ? prevRecord.ignitionOnTime : null;
        let ignitionOffTime = prevRecord ? prevRecord.ignitionOffTime : null;
        const now = new Date(locationData.timestamp);

        if (locationData.speed > 2) {
            status = 'running';
            // Reset state timers since vehicle is moving
            ignitionOnTime = null;
            ignitionOffTime = null;
        } else {
            // Stationary (speed <= 2)
            if (locationData.ignition === true) {
                if (!prevRecord || prevRecord.ignition === false || !ignitionOnTime) {
                    ignitionOnTime = now.toISOString();
                    ignitionOffTime = null;
                }
                const durationOn = ignitionOnTime ? (now - new Date(ignitionOnTime)) / 1000 : 0;
                status = (durationOn >= 10) ? 'idle' : 'running';
            } else {
                // Ignition OFF: Halt after 60s, else running/idle from prevRecord
                if (!prevRecord || prevRecord.ignition === true || prevRecord.ignition === undefined || !ignitionOffTime) {
                    ignitionOffTime = now.toISOString();
                    ignitionOnTime = null;
                }
                const durationOff = ignitionOffTime ? (now - new Date(ignitionOffTime)) / 1000 : 0;
                status = (durationOff >= 60) ? 'halt' : (prevRecord ? prevRecord.status : 'running');
            }
        }

        let powerSource = 'primary';
        let event = locationData.event || '';
        if (locationData.mainPower === false || (locationData.voltage !== undefined && locationData.voltage < 5.0)) {
            powerSource = 'secondary';
            event = 'Backup Battery Warning';
        }

        let prevAccumulated = 0;
        if (prevRecord) {
            if (prevRecord.accumulatedDistance !== undefined) {
                prevAccumulated = prevRecord.accumulatedDistance;
            } else {
                prevAccumulated = Math.max(0, (prevRecord.odometer || 0) - initialOdo);
            }
        }
        const deltaDistanceKm = (locationData.deltaDistance || 0) / 1000;
        let accumulatedDistance = prevAccumulated + deltaDistanceKm;
        let odometer = initialOdo + accumulatedDistance;

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
            event: event,
            odometer: odometer,
            accumulatedDistance: accumulatedDistance,
            rawHex: locationData.rawHex || '',
            status: status,
            ignitionOnTime: ignitionOnTime,
            ignitionOffTime: ignitionOffTime,
            powerSource: powerSource,
            voltage: locationData.voltage !== undefined ? locationData.voltage : 12.0
        };

        data.deviceLastSeen[imei] = point;

        // Prevent saving invalid 0,0 coordinates to history path
        if (locationData.latitude && locationData.longitude && locationData.latitude !== 0 && locationData.longitude !== 0) {
            if (!data.deviceHistory[imei]) data.deviceHistory[imei] = [];
            data.deviceHistory[imei].push(point);
            if (data.deviceHistory[imei].length > 500) data.deviceHistory[imei].shift();
        }

        writeData(data);
        return [];
    },
    getHistory: async (imei) => {
        const data = readData();
        return data.deviceHistory[imei] || [];
    },

    // Geofencing
    getGeofences: async (userId) => {
        const data = readData();
        return data.geofences.filter(g => g.userId === userId);
    },
    addGeofence: async (geofence) => {
        const data = readData();
        geofence.id = Date.now().toString();
        data.geofences.push(geofence);
        writeData(data);
        return geofence;
    },
    deleteGeofence: async (id) => {
        const data = readData();
        const initialLen = data.geofences.length;
        data.geofences = data.geofences.filter(g => g.id !== id);
        writeData(data);
        return data.geofences.length < initialLen;
    },
    updateGeofence: async (id, updates) => {
        const data = readData();
        const gf = data.geofences.find(g => g.id === id);
        if (gf) {
            Object.assign(gf, updates);
            writeData(data);
            return true;
        }
        return false;
    },

    updateSubscriptionValidity: async (userId, extraDays) => {
        const data = readData();
        const sub = data.subscriptions.find(s => s.userId === userId);
        if (sub) {
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
    createKycApplication: async (appData) => {
        const data = readData();
        data.kycApplications = data.kycApplications.filter(k => !(k.userId === appData.userId && k.status !== 'verified'));
        const kyc = {
            id: Date.now().toString(),
            userId: appData.userId,
            applicantType: appData.applicantType,
            fullName: appData.fullName,
            docType: appData.docType,
            docNumber: appData.docNumber,
            orgName: appData.orgName || '',
            gstNumber: appData.gstNumber || '',
            authSignatory: appData.authSignatory || '',
            status: 'under_review',
            submittedAt: new Date().toISOString(),
            reviewedAt: null,
            rejectReason: null
        };
        data.kycApplications.push(kyc);
        writeData(data);
        return kyc;
    },
    getKycApplications: async () => {
        const data = readData();
        return data.kycApplications.map(k => {
            const u = data.users.find(usr => usr.id === k.userId);
            return {
                ...k,
                username: u ? u.username : 'Unknown'
            };
        });
    },
    getKycByUserId: async (userId) => {
        const data = readData();
        return data.kycApplications.find(k => k.userId === userId) || null;
    },
    updateKycStatus: async (kycId, status, rejectReason = null) => {
        const data = readData();
        const kyc = data.kycApplications.find(k => k.id === kycId);
        if (!kyc) return false;
        kyc.status = status;
        kyc.reviewedAt = new Date().toISOString();
        if (rejectReason) kyc.rejectReason = rejectReason;
        writeData(data);
        return true;
    },

    // Device Settings & Configurations
    getDeviceSettings: async (imei) => {
        const data = readData();
        return { ...defaultSettings, ...(data.deviceSettings[imei] || {}) };
    },
    updateDeviceSettings: async (imei, settings) => {
        const data = readData();
        data.deviceSettings[imei] = {
            ...(data.deviceSettings[imei] || defaultSettings),
            ...settings
        };
        writeData(data);
        return true;
    },
    getUserSettings: async (userId) => {
        const data = readData();
        return { ...defaultSettings, ...(data.userSettings[userId] || {}) };
    },
    updateUserSettings: async (userId, settings) => {
        const data = readData();
        data.userSettings[userId] = {
            ...(data.userSettings[userId] || defaultSettings),
            ...settings
        };
        writeData(data);
        return true;
    },

    // Password resets
    resetPassword: async (userId, newPassword) => {
        const data = readData();
        const user = data.users.find(u => u.id === userId);
        if (!user) return false;
        user.password = encrypt(newPassword);
        writeData(data);
        return true;
    },

    // Pricing & Simulated Payments Log
    getSystemSettings: async () => {
        const data = readData();
        return data.systemSettings || defaultData.systemSettings;
    },
    updateSystemSettings: async (plans) => {
        const data = readData();
        data.systemSettings = plans;
        writeData(data);
        return true;
    },
    getPayments: async () => {
        const data = readData();
        return (data.payments || []).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    },
    getTotalIncome: async () => {
        const data = readData();
        return (data.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
    },

    // Plan upgrades & Simulated Checkout log
    updateCustomerPlan: async (userId, planName, pricePaid, customDeviceLimit = null) => {
        const data = readData();
        const user = data.users.find(u => u.id === userId);
        if (!user) return null;

        let price = pricePaid;
        let validityDays = 30;
        let deviceLimit = 2;

        const pricing = data.systemSettings || defaultData.systemSettings;
        const config = pricing[planName];
        if (config) {
            price = config.price;
            validityDays = config.validityDays;
            deviceLimit = config.deviceLimit;
        }

        if (customDeviceLimit !== null && customDeviceLimit !== undefined && customDeviceLimit !== '') {
            deviceLimit = parseInt(customDeviceLimit);
        }

        let sub = data.subscriptions.find(s => s.userId === userId);
        const now = new Date();
        let expirationDate = new Date();

        if (sub) {
            const currentExp = new Date(sub.expirationDate);
            const baseDate = currentExp > now ? currentExp : now;
            baseDate.setDate(baseDate.getDate() + validityDays);
            expirationDate = baseDate;

            sub.planName = planName;
            sub.deviceLimit = deviceLimit;
            sub.pricePaid = price;
            sub.validityDays = validityDays;
            sub.expirationDate = expirationDate.toISOString();
        } else {
            expirationDate.setDate(expirationDate.getDate() + validityDays);
            sub = {
                userId,
                planName,
                deviceLimit,
                pricePaid: price,
                validityDays,
                expirationDate: expirationDate.toISOString()
            };
            data.subscriptions.push(sub);
        }

        if (!data.payments) data.payments = [];
        data.payments.push({
            id: Date.now().toString() + Math.floor(Math.random() * 1000),
            userId,
            username: user.username,
            planName,
            amount: price,
            timestamp: new Date().toISOString()
        });

        writeData(data);
        return {
            planName: sub.planName,
            deviceLimit: sub.deviceLimit,
            expirationDate: sub.expirationDate,
            validityDays: sub.validityDays,
            pricePaid: sub.pricePaid
        };
    },

    // Custom asset edit methods
    renameDevice: async (imei, userId, newName) => {
        const data = readData();
        const dev = data.devices.find(d => d.imei === imei && d.ownerId === userId);
        if (dev) {
            dev.name = newName;
            writeData(data);
            return true;
        }
        return false;
    },
    updateDriver: async (imei, userId, driverName) => {
        const data = readData();
        const dev = data.devices.find(d => d.imei === imei && d.ownerId === userId);
        if (dev) {
            dev.driverName = driverName;
            writeData(data);
            return true;
        }
        return false;
    },
    updateVehicleProfile: async (imei, userId, vehicleProfile, initialOdometer) => {
        const data = readData();
        const dev = data.devices.find(d => d.imei === imei && d.ownerId === userId);
        if (dev) {
            const oldInitialOdo = dev.initialOdometer || 0;
            const newInitialOdo = parseFloat(initialOdometer || 0);
            dev.vehicleProfile = vehicleProfile;
            dev.initialOdometer = newInitialOdo;

            if (data.deviceLastSeen && data.deviceLastSeen[imei]) {
                const prevRecord = data.deviceLastSeen[imei];
                const accumulatedDistance = prevRecord.accumulatedDistance !== undefined ?
                    prevRecord.accumulatedDistance : Math.max(0, (prevRecord.odometer || 0) - oldInitialOdo);
                prevRecord.accumulatedDistance = accumulatedDistance;
                prevRecord.odometer = newInitialOdo + accumulatedDistance;
            } else {
                data.deviceLastSeen[imei] = {
                    odometer: newInitialOdo,
                    accumulatedDistance: 0
                };
            }
            writeData(data);
            return true;
        }
        return false;
    },

    // Public Sharing Links
    createSharedLink: async (imei, durationMinutes) => {
        const data = readData();
        if (!data.sharedLinks) data.sharedLinks = [];
        const id = Math.random().toString(36).substring(2, 18);
        const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
        const link = { id, imei, expiresAt };
        data.sharedLinks.push(link);
        writeData(data);
        return link;
    },
    getSharedLink: async (id) => {
        const data = readData();
        if (!data.sharedLinks) data.sharedLinks = [];
        const link = data.sharedLinks.find(l => l.id === id);
        if (link) {
            if (new Date() < new Date(link.expiresAt)) {
                return link;
            } else {
                data.sharedLinks = data.sharedLinks.filter(l => l.id !== id);
                writeData(data);
            }
        }
        return null;
    },

    // Admin direct subscription editor
    updateCustomerSubscriptionAdmin: async (userId, deviceLimit, extraDays) => {
        const data = readData();
        let sub = data.subscriptions.find(s => s.userId === userId);
        if (sub) {
            sub.deviceLimit = parseInt(deviceLimit);
            if (parseInt(extraDays) > 0) {
                const now = new Date();
                const baseDate = new Date(sub.expirationDate) > now ? new Date(sub.expirationDate) : now;
                baseDate.setDate(baseDate.getDate() + parseInt(extraDays));
                sub.expirationDate = baseDate.toISOString();
                sub.validityDays = (sub.validityDays || 10) + parseInt(extraDays);
            }
            writeData(data);
            return {
                userId: sub.userId,
                planName: sub.planName || 'Trial',
                deviceLimit: sub.deviceLimit,
                pricePaid: sub.pricePaid || 0,
                validityDays: sub.validityDays,
                expirationDate: sub.expirationDate
            };
        } else {
            const expirationDate = new Date();
            expirationDate.setDate(expirationDate.getDate() + parseInt(extraDays || 30));
            const newSub = {
                userId,
                planName: 'Free',
                deviceLimit: parseInt(deviceLimit || 100),
                pricePaid: 0,
                validityDays: parseInt(extraDays || 30),
                expirationDate: expirationDate.toISOString()
            };
            data.subscriptions.push(newSub);
            writeData(data);
            return newSub;
        }
    }
};
