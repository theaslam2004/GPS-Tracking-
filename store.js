const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const dataFile = process.env.DATA_FILE_PATH ? path.resolve(process.env.DATA_FILE_PATH) : path.join(__dirname, 'data.json');

// Encryption Helpers for Password Storage (AES-256)
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

const DEFAULT_KEY_RAW = crypto.createHash('sha256').update('fleetly-gps-default-key-change-in-prod-2026').digest();

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
        if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY !== 'fleetly-gps-default-key-change-in-prod-2026') {
            try {
                const parts = text.split(':');
                const iv = Buffer.from(parts[1], 'hex');
                const encryptedText = parts[2];
                const decipher = crypto.createDecipheriv('aes-256-cbc', DEFAULT_KEY_RAW, iv);
                let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                return decrypted;
            } catch(fallbackErr) {
                console.error("[Crypto] Decryption fallback failed:", fallbackErr.message);
            }
        }
        console.error("[Crypto] Decryption failed:", e.message);
        return text;
    }
}

async function checkPassword(inputPassword, storedPassword) {
    if (!storedPassword) return false;
    if (storedPassword.startsWith('enc:')) {
        return decrypt(storedPassword) === inputPassword;
    } else if (storedPassword.startsWith('$2a$') || storedPassword.startsWith('$2b$') || storedPassword.startsWith('$2y$')) {
        try {
            return await bcrypt.compare(inputPassword, storedPassword);
        } catch(e) {
            return false;
        }
    } else {
        return storedPassword === inputPassword;
    }
}

// Default initial state
const defaultData = {
    users: [
        { id: '1', username: 'admin', password: 'password', role: 'admin' }
    ],
    devices: [],
    deviceRequests: [],
    subscriptions: [],
    deviceLastSeen: {},
    deviceHistory: {},
    geofences: [],
    kycApplications: [],
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

// JSON Store File Operations
function readData() {
    try {
        if (!fs.existsSync(dataFile)) {
            writeData(defaultData);
            return defaultData;
        }
        const raw = fs.readFileSync(dataFile, 'utf8');
        const parsed = JSON.parse(raw);
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
        
        // --- LIVE PORTAL CLEANUP ---
        // If we are NOT running on localhost with LOCAL_SIMULATOR=true, wipe the simulator from memory
        if (process.env.LOCAL_SIMULATOR !== 'true') {
            console.log('[Startup Cleanup] Removing simulator from live portal memory...');
            const simImeis = ['862170070000001', '352914091691580', '866359076347189_SIM'];
            if (parsed.devices) {
                parsed.devices = parsed.devices.filter(d => !simImeis.includes(d.imei));
            }
            if (parsed.deviceLastSeen) {
                simImeis.forEach(imei => delete parsed.deviceLastSeen[imei]);
            }
            if (parsed.deviceSettings) {
                simImeis.forEach(imei => delete parsed.deviceSettings[imei]);
            }
            if (parsed.users) {
                parsed.users = parsed.users.filter(u => u.id !== '1781624485663');
            }
        }

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

// ── MONGOOSE CONNECTION & SCHEMAS ──
let useMongo = false;
let mongoConnectionPromise = null;
const MONGODB_URI = process.env.MONGODB_URI;

// Define Schemas
const UserSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    parentId: { type: String, default: null, index: true },
    username: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true },
    role: { type: String, required: true, default: 'customer' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' }
});

const DeviceSchema = new mongoose.Schema({
    imei: { type: String, required: true, unique: true, index: true },
    ownerId: { type: String, required: true, index: true },
    name: { type: String, required: true, default: 'New Asset' },
    pinned: { type: Boolean, default: false },
    driverName: { type: String, default: 'Unassigned' },
    vehicleProfile: { type: String, default: 'standard' },
    initialOdometer: { type: Number, default: 0 },
    assignedTo: { type: [String], default: [] }
});

const DeviceRequestSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    imei: { type: String, required: true },
    userId: { type: String, required: true },
    status: { type: String, default: 'pending' },
    timestamp: { type: Date, default: Date.now }
});

const SubscriptionSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },
    planName: { type: String, required: true, default: 'Trial' },
    deviceLimit: { type: Number, required: true, default: 100 },
    pricePaid: { type: Number, required: true, default: 0 },
    validityDays: { type: Number, required: true, default: 10 },
    expirationDate: { type: Date, required: true }
});

const DeviceLastSeenSchema = new mongoose.Schema({
    imei: { type: String, required: true, unique: true, index: true },
    timestamp: { type: Date, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    speed: { type: Number, required: true },
    heading: { type: Number, default: 0 },
    satellites: { type: Number, default: 0 },
    gpsValid: { type: Boolean, default: true },
    battery: { type: Number, default: 90 },
    ignition: { type: Boolean, default: false },
    packetType: { type: String, required: true },
    event: { type: String, default: '' },
    odometer: { type: Number, default: 0 },
    accumulatedDistance: { type: Number, default: 0 },
    rawHex: { type: String, default: '' },
    status: { type: String, default: 'offline' },
    ignitionOnTime: { type: Date, default: null },
    ignitionOffTime: { type: Date, default: null },
    powerSource: { type: String, default: 'primary' },
    voltage: { type: Number, default: 12.0 }
});

const DeviceHistoryPointSchema = new mongoose.Schema({
    imei: { type: String, required: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    speed: { type: Number, required: true },
    heading: { type: Number, default: 0 },
    satellites: { type: Number, default: 0 },
    gpsValid: { type: Boolean, default: true },
    battery: { type: Number, default: 90 },
    ignition: { type: Boolean, default: false },
    packetType: { type: String, default: '' },
    event: { type: String, default: '' },
    odometer: { type: Number, default: 0 },
    accumulatedDistance: { type: Number, default: 0 },
    rawHex: { type: String, default: '' },
    status: { type: String, default: 'offline' },
    ignitionOnTime: { type: Date, default: null },
    ignitionOffTime: { type: Date, default: null },
    powerSource: { type: String, default: 'primary' },
    voltage: { type: Number, default: 12.0 }
});

const GeofenceSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    type: { type: String, required: true },
    points: { type: [[Number]], required: true },
    radius: { type: Number, default: 0 }
});

const KycApplicationSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, unique: true, index: true },
    applicantType: { type: String, required: true },
    fullName: { type: String, required: true },
    docType: { type: String, required: true },
    docNumber: { type: String, required: true },
    orgName: { type: String, default: '' },
    gstNumber: { type: String, default: '' },
    authSignatory: { type: String, default: '' },
    status: { type: String, default: 'under_review' },
    submittedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null },
    rejectReason: { type: String, default: null }
});

const UserSettingsSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },
    settings: { type: Map, of: Boolean, default: {} }
});

const DeviceSettingsSchema = new mongoose.Schema({
    imei: { type: String, required: true, unique: true, index: true },
    settings: { type: Map, of: Boolean, default: {} }
});

const SystemSettingsSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    plans: {
        type: Map,
        of: new mongoose.Schema({
            name: String,
            price: Number,
            deviceLimit: Number,
            validityDays: Number
        }, { _id: false })
    }
});

const PaymentSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    username: { type: String, required: true },
    planName: { type: String, required: true },
    amount: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now }
});

const SharedLinkSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    imei: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true }
});

// Compile Models
const User = mongoose.model('User', UserSchema);
const Device = mongoose.model('Device', DeviceSchema);
const DeviceRequest = mongoose.model('DeviceRequest', DeviceRequestSchema);
const Subscription = mongoose.model('Subscription', SubscriptionSchema);
const DeviceLastSeen = mongoose.model('DeviceLastSeen', DeviceLastSeenSchema);
const DeviceHistoryPoint = mongoose.model('DeviceHistoryPoint', DeviceHistoryPointSchema);
const Geofence = mongoose.model('Geofence', GeofenceSchema);
const KycApplication = mongoose.model('KycApplication', KycApplicationSchema);
const UserSettings = mongoose.model('UserSettings', UserSettingsSchema);
const DeviceSettings = mongoose.model('DeviceSettings', DeviceSettingsSchema);
const SystemSettings = mongoose.model('SystemSettings', SystemSettingsSchema);
const Payment = mongoose.model('Payment', PaymentSchema);
const SharedLink = mongoose.model('SharedLink', SharedLinkSchema);

// Connection logic
if (MONGODB_URI) {
    console.log('[Database] MONGODB_URI detected. Initiating connection (5s timeout)...');
    mongoose.set('bufferCommands', false);
    mongoConnectionPromise = mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000
    }).then(() => {
        useMongo = true;
        console.log('[Database] Successfully connected to MongoDB Atlas. Active database: MongoDB.');
        return bootstrapAdminMongo().then(() => migrateJsonToMongo()).then(() => cleanupLivePortalSimulators());
    }).catch(err => {
        useMongo = false;
        console.error('[Database] MongoDB Connection failed or timed out:', err.message);
        console.log('[Database] Falling back to file-based JSON storage.');
    });
} else {
    console.log('[Database] MONGODB_URI not specified. Active database: JSON File.');
}

async function ensureDbConnected() {
    if (mongoConnectionPromise) {
        try {
            await mongoConnectionPromise;
        } catch(e) {
            // Error logged in main promise handler
        }
    }
}

async function migrateJsonToMongo() {
    try {
        console.log('[Migration] Cleaning up obsolete users and data...');
        // Clean up all users except admin, 123, and Prakash (case-insensitive)
        if (useMongo) {
            const allowedUsernames = ['admin', '123', 'prakash'];
            const allUsers = await User.find({});
            const usersToDelete = allUsers.filter(u => !allowedUsernames.includes(u.username.toLowerCase()));
            
            if (usersToDelete.length > 0) {
                const deleteIds = usersToDelete.map(u => u.id);
                const deleteUsernames = usersToDelete.map(u => u.username);
                console.log(`[Database Cleanup] Deleting obsolete users:`, deleteUsernames);
                
                // Delete users
                await User.deleteMany({ id: { $in: deleteIds } });
                
                // Find and delete devices owned by deleted users
                const devicesToDelete = await Device.find({ ownerId: { $in: deleteIds } });
                const deleteImeis = devicesToDelete.map(d => d.imei);
                
                if (deleteImeis.length > 0) {
                    console.log(`[Database Cleanup] Deleting obsolete devices:`, deleteImeis);
                    await Device.deleteMany({ imei: { $in: deleteImeis } });
                    await DeviceLastSeen.deleteMany({ imei: { $in: deleteImeis } });
                    await DeviceHistoryPoint.deleteMany({ imei: { $in: deleteImeis } });
                    await DeviceSettings.deleteMany({ imei: { $in: deleteImeis } });
                    await SharedLink.deleteMany({ imei: { $in: deleteImeis } });
                }
                
                // Delete associated user collections
                await Subscription.deleteMany({ userId: { $in: deleteIds } });
                await UserSettings.deleteMany({ userId: { $in: deleteIds } });
                await KycApplication.deleteMany({ userId: { $in: deleteIds } });
                await Payment.deleteMany({ userId: { $in: deleteIds } });
            }
        }

        console.log('[Migration] Checking for users to migrate from data.json...');
        
        const pathsToMigrate = [];
        const localGitPath = path.join(__dirname, 'data.json');
        
        if (fs.existsSync(localGitPath)) {
            pathsToMigrate.push(localGitPath);
        }
        if (process.env.DATA_FILE_PATH) {
            const envPath = path.resolve(process.env.DATA_FILE_PATH);
            if (fs.existsSync(envPath) && envPath !== localGitPath) {
                pathsToMigrate.push(envPath);
            }
        }

        console.log(`[Migration] Found ${pathsToMigrate.length} JSON sources to migrate:`, pathsToMigrate);

        for (const filePath of pathsToMigrate) {
            console.log(`[Migration] Reading file: ${filePath}`);
            const raw = fs.readFileSync(filePath, 'utf8');
            const data = JSON.parse(raw);

            // 1. Migrate Users
            if (data.users && data.users.length > 0) {
                console.log(`[Migration] Migrating ${data.users.length} users from ${filePath}...`);
                for (const u of data.users) {
                    const exists = await User.findOne({ username: u.username });
                    if (!exists) {
                        await User.create({
                            id: u.id,
                            parentId: u.parentId || null,
                            username: u.username,
                            password: u.password,
                            role: u.role,
                            phone: u.phone || '',
                            email: u.email || ''
                        });
                        console.log(`[Migration] Imported user: ${u.username}`);
                    }
                }
            }

            // 2. Migrate Devices
            if (data.devices && data.devices.length > 0) {
                console.log(`[Migration] Migrating ${data.devices.length} devices from ${filePath}...`);
                for (const d of data.devices) {
                    const exists = await Device.findOne({ imei: d.imei });
                    if (!exists) {
                        await Device.create({
                            imei: d.imei,
                            ownerId: d.ownerId,
                            name: d.name || 'New Asset',
                            pinned: d.pinned || false,
                            driverName: d.driverName || 'Unassigned',
                            vehicleProfile: d.vehicleProfile || 'standard',
                            initialOdometer: d.initialOdometer || 0,
                            assignedTo: d.assignedTo || []
                        });
                    }
                }
            }

            // 3. Migrate Device Requests
            if (data.deviceRequests && data.deviceRequests.length > 0) {
                console.log(`[Migration] Migrating ${data.deviceRequests.length} device requests from ${filePath}...`);
                for (const r of data.deviceRequests) {
                    const exists = await DeviceRequest.findOne({ id: r.id });
                    if (!exists) {
                        await DeviceRequest.create({
                            id: r.id,
                            imei: r.imei,
                            userId: r.userId,
                            status: r.status || 'pending',
                            timestamp: new Date(r.timestamp)
                        });
                    }
                }
            }

            // 4. Migrate Subscriptions
            if (data.subscriptions && data.subscriptions.length > 0) {
                console.log(`[Migration] Migrating ${data.subscriptions.length} subscriptions from ${filePath}...`);
                for (const s of data.subscriptions) {
                    const exists = await Subscription.findOne({ userId: s.userId });
                    if (!exists) {
                        await Subscription.create({
                            userId: s.userId,
                            planName: s.planName || 'Trial',
                            deviceLimit: s.deviceLimit || 100,
                            pricePaid: s.pricePaid || 0,
                            validityDays: s.validityDays || 10,
                            expirationDate: new Date(s.expirationDate)
                        });
                    }
                }
            }

            // 5. Migrate Device Last Seen
            if (data.deviceLastSeen && Object.keys(data.deviceLastSeen).length > 0) {
                console.log(`[Migration] Migrating device last seen records from ${filePath}...`);
                for (const imei of Object.keys(data.deviceLastSeen)) {
                    const ls = data.deviceLastSeen[imei];
                    const exists = await DeviceLastSeen.findOne({ imei });
                    if (!exists) {
                        await DeviceLastSeen.create({
                            imei: imei,
                            timestamp: new Date(ls.timestamp || Date.now()),
                            latitude: ls.latitude || 0,
                            longitude: ls.longitude || 0,
                            speed: ls.speed || 0,
                            heading: ls.heading || 0,
                            satellites: ls.satellites || 0,
                            gpsValid: ls.gpsValid !== undefined ? ls.gpsValid : true,
                            battery: ls.battery !== undefined ? ls.battery : 90,
                            ignition: ls.ignition || false,
                            packetType: ls.packetType || 'INIT',
                            event: ls.event || '',
                            odometer: ls.odometer || 0,
                            accumulatedDistance: ls.accumulatedDistance || 0,
                            rawHex: ls.rawHex || '',
                            status: ls.status || 'offline',
                            ignitionOnTime: ls.ignitionOnTime ? new Date(ls.ignitionOnTime) : null,
                            ignitionOffTime: ls.ignitionOffTime ? new Date(ls.ignitionOffTime) : null,
                            powerSource: ls.powerSource || 'primary',
                            voltage: ls.voltage !== undefined ? ls.voltage : 12.0
                        });
                    }
                }
            }

            // 6. Migrate Geofences
            if (data.geofences && data.geofences.length > 0) {
                console.log(`[Migration] Migrating ${data.geofences.length} geofences from ${filePath}...`);
                for (const g of data.geofences) {
                    const exists = await Geofence.findOne({ id: g.id });
                    if (!exists) {
                        await Geofence.create({
                            id: g.id,
                            userId: g.userId,
                            name: g.name,
                            type: g.type,
                            points: g.points,
                            radius: g.radius || 0
                        });
                    }
                }
            }

            // 7. Migrate KYC Applications
            if (data.kycApplications && data.kycApplications.length > 0) {
                console.log(`[Migration] Migrating ${data.kycApplications.length} KYC applications from ${filePath}...`);
                for (const k of data.kycApplications) {
                    const exists = await KycApplication.findOne({ id: k.id });
                    if (!exists) {
                        await KycApplication.create({
                            id: k.id,
                            userId: k.userId,
                            applicantType: k.applicantType,
                            fullName: k.fullName,
                            docType: k.docType,
                            docNumber: k.docNumber,
                            orgName: k.orgName || '',
                            gstNumber: k.gstNumber || '',
                            authSignatory: k.authSignatory || '',
                            status: k.status || 'under_review',
                            submittedAt: new Date(k.submittedAt),
                            reviewedAt: k.reviewedAt ? new Date(k.reviewedAt) : null,
                            rejectReason: k.rejectReason || null
                        });
                    }
                }
            }

            // 8. Migrate User Settings
            if (data.userSettings && Object.keys(data.userSettings).length > 0) {
                console.log(`[Migration] Migrating user settings from ${filePath}...`);
                for (const userId of Object.keys(data.userSettings)) {
                    const exists = await UserSettings.findOne({ userId });
                    if (!exists) {
                        await UserSettings.create({
                            userId,
                            settings: data.userSettings[userId]
                        });
                    }
                }
            }

            // 9. Migrate Device Settings
            if (data.deviceSettings && Object.keys(data.deviceSettings).length > 0) {
                console.log(`[Migration] Migrating device settings from ${filePath}...`);
                for (const imei of Object.keys(data.deviceSettings)) {
                    const exists = await DeviceSettings.findOne({ imei });
                    if (!exists) {
                        await DeviceSettings.create({
                            imei,
                            settings: data.deviceSettings[imei]
                        });
                    }
                }
            }

            // 10. Migrate Payments
            if (data.payments && data.payments.length > 0) {
                console.log(`[Migration] Migrating ${data.payments.length} payments from ${filePath}...`);
                for (const p of data.payments) {
                    const exists = await Payment.findOne({ id: p.id });
                    if (!exists) {
                        await Payment.create({
                            id: p.id,
                            userId: p.userId,
                            username: p.username,
                            planName: p.planName,
                            amount: p.amount,
                            timestamp: new Date(p.timestamp)
                        });
                    }
                }
            }

            // 11. Migrate Shared Links
            if (data.sharedLinks && data.sharedLinks.length > 0) {
                console.log(`[Migration] Migrating ${data.sharedLinks.length} shared links from ${filePath}...`);
                for (const l of data.sharedLinks) {
                    const exists = await SharedLink.findOne({ id: l.id });
                    if (!exists) {
                        await SharedLink.create({
                            id: l.id,
                            imei: l.imei,
                            expiresAt: new Date(l.expiresAt)
                        });
                    }
                }
            }
        }

        // 12. Migrate Device History from files
        const historyDir = path.join(__dirname, 'history');
        if (fs.existsSync(historyDir)) {
            const files = fs.readdirSync(historyDir);
            console.log(`[Migration] Found ${files.length} history files to migrate.`);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const imei = path.basename(file, '.json');
                    const filePath = path.join(historyDir, file);
                    try {
                        const fileContent = fs.readFileSync(filePath, 'utf8');
                        const points = JSON.parse(fileContent);
                        if (Array.isArray(points) && points.length > 0) {
                            console.log(`[Migration] Migrating ${points.length} history points for IMEI: ${imei}...`);
                            
                            // Fetch all existing points' timestamps for this imei in bulk to speed up checks
                            const existingPoints = await DeviceHistoryPoint.find({ imei }, { timestamp: 1 }).lean();
                            const existingSet = new Set(existingPoints.map(p => new Date(p.timestamp).getTime()));
                            
                            const ops = [];
                            for (const pt of points) {
                                const timestamp = new Date(pt.timestamp);
                                if (!existingSet.has(timestamp.getTime())) {
                                    ops.push({
                                        imei,
                                        timestamp,
                                        latitude: pt.latitude,
                                        longitude: pt.longitude,
                                        speed: pt.speed,
                                        heading: pt.heading || 0,
                                        satellites: pt.satellites || 0,
                                        gpsValid: pt.gpsValid !== undefined ? pt.gpsValid : true,
                                        battery: pt.battery !== undefined ? pt.battery : 90,
                                        ignition: pt.ignition || false,
                                        packetType: pt.packetType || '',
                                        event: pt.event || '',
                                        odometer: pt.odometer || 0,
                                        accumulatedDistance: pt.accumulatedDistance || 0,
                                        rawHex: pt.rawHex || '',
                                        status: pt.status || 'offline',
                                        ignitionOnTime: pt.ignitionOnTime ? new Date(pt.ignitionOnTime) : null,
                                        ignitionOffTime: pt.ignitionOffTime ? new Date(pt.ignitionOffTime) : null,
                                        powerSource: pt.powerSource || 'primary',
                                        voltage: pt.voltage !== undefined ? pt.voltage : 12.0
                                    });
                                }
                            }
                            if (ops.length > 0) {
                                await DeviceHistoryPoint.insertMany(ops);
                                console.log(`[Migration] Inserted ${ops.length} new history points for IMEI: ${imei}.`);
                            } else {
                                console.log(`[Migration] All history points for IMEI ${imei} already exist in DB.`);
                            }
                        }
                    } catch (err) {
                        console.error(`[Migration] Failed to migrate history file ${file}:`, err.message);
                    }
                }
            }
        }

        console.log('[Migration] Database migration completed successfully!');
    } catch (err) {
        console.error('[Migration] Critical error during migration:', err);
    }
}

async function cleanupLivePortalSimulators() {
    try {
        console.log('[Cleanup] Removing simulator data from live MongoDB...');
        const simUserId = '1781624485663';
        const simDeviceImeis = ['862170070000001', '352914091691580', '866359076347189_SIM'];
        
        await User.deleteOne({ id: simUserId });
        await Subscription.deleteOne({ userId: simUserId });
        await Device.deleteMany({ imei: { $in: simDeviceImeis } });
        await DeviceLastSeen.deleteMany({ imei: { $in: simDeviceImeis } });
        await DeviceHistoryPoint.deleteMany({ imei: { $in: simDeviceImeis } });
        await DeviceSettings.deleteMany({ imei: { $in: simDeviceImeis } });
        await UserSettings.deleteOne({ userId: simUserId });
        
        // Clean up accidental Bangalore coordinates from real devices
        console.log('[Cleanup] Purging accidental Bangalore coordinates...');
        await DeviceHistoryPoint.deleteMany({ latitude: { $gte: 12.9, $lte: 13.0 }, longitude: { $gte: 77.5, $lte: 77.6 } });
        await DeviceLastSeen.updateMany(
            { latitude: { $gte: 12.9, $lte: 13.0 }, longitude: { $gte: 77.5, $lte: 77.6 } },
            { $set: { latitude: 0, longitude: 0 } }
        );
        
        console.log('[Cleanup] Simulator data and Bangalore fallbacks completely purged from MongoDB.');
    } catch (err) {
        console.error('[Cleanup] Error removing simulator data:', err);
    }
}

// Bootstrapping admin functions
async function bootstrapAdminMongo() {
    try {
        const count = await User.countDocuments({ role: 'admin' });
        if (count === 0) {
            console.log('[Database Seed] Seeding default admin into MongoDB...');
            await User.create({
                id: '1',
                username: 'admin',
                password: encrypt('password'),
                role: 'admin'
            });
            console.log('[Database Seed] seeded admin.');
        }

        const pricingExists = await SystemSettings.findOne({ key: 'pricing' });
        if (!pricingExists) {
            console.log('[Database Seed] Seeding default pricing configurations into MongoDB...');
            await SystemSettings.create({
                key: 'pricing',
                plans: {
                    'Trial': { name: 'Trial', price: 0, deviceLimit: 100, validityDays: 10 },
                    'Basic': { name: 'Basic', price: 99, deviceLimit: 2, validityDays: 30 },
                    'Standard': { name: 'Standard', price: 199, deviceLimit: 5, validityDays: 30 },
                    'Premium': { name: 'Premium', price: 399, deviceLimit: 15, validityDays: 30 },
                    'Enterprise': { name: 'Enterprise', price: 999, deviceLimit: 500, validityDays: 30 }
                }
            });
            console.log('[Database Seed] seeded pricing.');
        }
    } catch(e) {
        console.error('[Database Seed] Failed to bootstrap admin in MongoDB:', e);
    }
}

function bootstrapAdminJSON() {
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
        console.log('[Database Seed] Default admin seeded in JSON.');
    }
}
bootstrapAdminJSON(); // Always bootstrap JSON just in case fallback triggers

module.exports = {
    getData: async () => {
        await ensureDbConnected();
        if (useMongo) {
            const devices = await Device.find({});
            const deviceLastSeen = {};
            const lastSeenList = await DeviceLastSeen.find({});
            lastSeenList.forEach(ls => {
                deviceLastSeen[ls.imei] = ls.toObject();
            });
            const deviceRequests = await DeviceRequest.find({});
            return {
                devices: devices.map(d => d.toObject()),
                deviceLastSeen,
                deviceRequests: deviceRequests.map(r => r.toObject())
            };
        } else {
            const data = readData();
            return {
                devices: data.devices,
                deviceLastSeen: data.deviceLastSeen,
                deviceRequests: data.deviceRequests
            };
        }
    },

    // Users
    getUser: async (username, password) => {
        await ensureDbConnected();
        if (useMongo) {
            const user = await User.findOne({ username });
            if (!user) return null;
            const isMatch = await checkPassword(password, user.password);
            if (isMatch) {
                return { id: user.id, username: user.username, role: user.role };
            }
            return null;
        } else {
            const data = readData();
            const user = data.users.find(u => u.username === username);
            if (user && await checkPassword(password, user.password)) {
                return { id: user.id, username: user.username, role: user.role };
            }
            return null;
        }
    },
    getUserById: async (id) => {
        await ensureDbConnected();
        if (useMongo) {
            const user = await User.findOne({ id });
            if (user) {
                return { id: user.id, username: user.username, role: user.role, parentId: user.parentId };
            }
            return null;
        } else {
            const data = readData();
            const user = data.users.find(u => u.id === id);
            if (user) {
                return { id: user.id, username: user.username, role: user.role, parentId: user.parentId };
            }
            return null;
        }
    },
    getUserCredentials: async (userId) => {
        await ensureDbConnected();
        if (useMongo) {
            const user = await User.findOne({ id: userId });
            if (!user) return null;
            return {
                username: user.username,
                password: 'Protected (Bcrypt/Encrypted - use Reset Form)'
            };
        } else {
            const data = readData();
            const user = data.users.find(u => u.id === userId);
            if (!user) return null;
            return {
                username: user.username,
                password: 'Protected (Encrypted - use Reset Form)'
            };
        }
    },
    createUser: async (username, password, phone = '', email = '') => {
        await ensureDbConnected();
        if (useMongo) {
            const exists = await User.findOne({ username });
            if (exists) return null;

            const userId = Date.now().toString();
            const newUser = await User.create({
                id: userId,
                username,
                password: encrypt(password),
                role: 'customer',
                phone: phone || '',
                email: email || ''
            });

            let trialDays = 10;
            let trialLimit = 100;
            try {
                const settings = await SystemSettings.findOne({ key: 'pricing' });
                if (settings && settings.plans && settings.plans.get('Trial')) {
                    const trialPlan = settings.plans.get('Trial');
                    trialDays = trialPlan.validityDays || 10;
                    trialLimit = trialPlan.deviceLimit || 100;
                }
            } catch (e) {
                console.error('[Database] Error reading Trial configs:', e);
            }

            const expirationDate = new Date();
            expirationDate.setDate(expirationDate.getDate() + trialDays);

            await Subscription.create({
                userId,
                planName: 'Trial',
                deviceLimit: trialLimit,
                pricePaid: 0,
                validityDays: trialDays,
                expirationDate
            });

            return { id: newUser.id, username: newUser.username, role: newUser.role, phone: newUser.phone, email: newUser.email };
        } else {
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
        }
    },
    updateUserContact: async (userId, phone, email) => {
        await ensureDbConnected();
        if (useMongo) {
            const user = await User.findOne({ id: userId });
            if (!user) return false;
            if (phone !== undefined) user.phone = phone;
            if (email !== undefined) user.email = email;
            await user.save();
            return true;
        } else {
            const data = readData();
            const user = data.users.find(u => u.id === userId);
            if (!user) return false;
            if (phone !== undefined) user.phone = phone;
            if (email !== undefined) user.email = email;
            writeData(data);
            return true;
        }
    },
    getCustomerContact: async (userId) => {
        await ensureDbConnected();
        if (useMongo) {
            const user = await User.findOne({ id: userId });
            if (!user) return null;
            return { username: user.username, phone: user.phone || '', email: user.email || '' };
        } else {
            const data = readData();
            const user = data.users.find(u => u.id === userId);
            if (!user) return null;
            return { username: user.username, phone: user.phone || '', email: user.email || '' };
        }
    },
    getAllCustomers: async () => {
        await ensureDbConnected();
        if (useMongo) {
            const users = await User.find({ role: 'customer' });
            const customers = [];
            for (let u of users) {
                const sub = await Subscription.findOne({ userId: u.id });
                let formattedSub = null;
                if (sub) {
                    const expDate = new Date(sub.expirationDate);
                    const daysLeft = Math.max(0, Math.ceil((expDate - new Date()) / (1000 * 60 * 60 * 24)));
                    formattedSub = {
                        userId: sub.userId,
                        validityDays: sub.validityDays,
                        expirationDate: sub.expirationDate.toISOString(),
                        daysLeft,
                        planName: sub.planName || 'Trial',
                        deviceLimit: sub.deviceLimit || 1,
                        pricePaid: sub.pricePaid || 0
                    };
                }
                customers.push({
                    id: u.id,
                    username: u.username,
                    phone: u.phone || '',
                    email: u.email || '',
                    subscription: formattedSub
                });
            }
            return customers;
        } else {
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
        }
    },

    // Registration & Device Ops
    requestDevice: async (userId, imei) => {
        await ensureDbConnected();
        if (useMongo) {
            const user = await User.findOne({ id: userId });
            if (!user) return { error: 'User not found' };

            const deviceExists = await Device.findOne({ imei });
            if (deviceExists && deviceExists.ownerId === userId) {
                return { error: 'Device is already registered to your account' };
            }

            const pendingRequest = await DeviceRequest.findOne({ imei, status: 'pending' });
            if (pendingRequest) return { error: 'A request is already pending for this device' };

            const activeCount = await Device.countDocuments({ ownerId: userId });
            const pendingCount = await DeviceRequest.countDocuments({ userId, status: 'pending' });

            const sub = await Subscription.findOne({ userId });
            const limit = sub ? (sub.deviceLimit || 100) : 100;

            if (activeCount + pendingCount >= limit) {
                return { error: `Device limit reached. Your current plan allows up to ${limit} device(s). Please contact admin to increase your limit.` };
            }

            const req = await DeviceRequest.create({
                id: Date.now().toString(),
                imei,
                userId,
                status: 'pending',
                timestamp: new Date()
            });
            return req.toObject();
        } else {
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
        }
    },
    rejectDeviceRequest: async (imei) => {
        await ensureDbConnected();
        if (useMongo) {
            const result = await DeviceRequest.updateOne(
                { imei, status: 'pending' },
                { $set: { status: 'rejected', timestamp: new Date() } }
            );
            return result.modifiedCount > 0;
        } else {
            const data = readData();
            const req = data.deviceRequests.find(r => r.imei === imei && r.status === 'pending');
            if (req) {
                req.status = 'rejected';
                req.timestamp = new Date().toISOString();
                writeData(data);
                return true;
            }
            return false;
        }
    },
    approveDeviceRequest: async (imei, userId) => {
        await ensureDbConnected();
        if (useMongo) {
            await DeviceRequest.updateMany(
                { imei, status: 'pending' },
                { $set: { status: 'approved', userId, timestamp: new Date() } }
            );
            const device = await Device.findOne({ imei });
            if (device) {
                device.ownerId = userId;
                await device.save();
            } else {
                await Device.create({
                    imei,
                    ownerId: userId,
                    name: 'New Asset',
                    driverName: 'Unassigned',
                    vehicleProfile: 'standard',
                    initialOdometer: 0
                });
            }
            return true;
        } else {
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
        }
    },
    deleteCustomer: async (userId) => {
        await ensureDbConnected();
        if (useMongo) {
            await User.deleteOne({ id: userId });
            await Device.deleteMany({ ownerId: userId });
            await Subscription.deleteOne({ userId });
            await Geofence.deleteMany({ userId });
            await KycApplication.deleteMany({ userId });
            await UserSettings.deleteOne({ userId });
            return true;
        } else {
            const data = readData();
            data.users = data.users.filter(u => u.id !== userId);
            data.devices = data.devices.filter(d => d.ownerId !== userId);
            data.subscriptions = data.subscriptions.filter(s => s.userId !== userId);
            data.geofences = data.geofences.filter(g => g.userId !== userId);
            data.kycApplications = data.kycApplications.filter(k => k.userId !== userId);
            writeData(data);
            return true;
        }
    },
    updateContact: async (userId, phone, email) => {
        await ensureDbConnected();
        if (useMongo) {
            const user = await User.findOne({ id: userId });
            if (user) {
                user.phone = phone;
                user.email = email;
                await user.save();
                return true;
            }
            return false;
        } else {
            const data = readData();
            const user = data.users.find(u => u.id === userId);
            if (user) {
                user.phone = phone;
                user.email = email;
                writeData(data);
                return true;
            }
            return false;
        }
    },
    addSubscriptionDays: async (userId, days) => {
        await ensureDbConnected();
        if (useMongo) {
            let sub = await Subscription.findOne({ userId });
            if (!sub) {
                const expDate = new Date();
                expDate.setDate(expDate.getDate() + days);
                await Subscription.create({
                    userId,
                    planName: 'Trial',
                    deviceLimit: 100,
                    pricePaid: 0,
                    validityDays: days,
                    expirationDate: expDate
                });
            } else {
                const currentExp = new Date(sub.expirationDate);
                const baseDate = currentExp > new Date() ? currentExp : new Date();
                baseDate.setDate(baseDate.getDate() + days);
                sub.expirationDate = baseDate;
                sub.validityDays = (sub.validityDays || 0) + days;
                await sub.save();
            }
            return true;
        } else {
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
        }
    },
    getCustomerDevices: async (userId) => {
        await ensureDbConnected();
        if (useMongo) {
            const user = await User.findOne({ id: userId });
            if (!user) return [];
            
            const subUserId = user.parentId || user.id;
            const sub = await Subscription.findOne({ userId: subUserId });
            if (sub && new Date() > new Date(sub.expirationDate)) {
                return []; // Subscription expired
            }
            
            if (user.parentId) {
                const list = await Device.find({ assignedTo: userId });
                return list.map(d => d.toObject());
            } else {
                const list = await Device.find({ ownerId: userId });
                return list.map(d => d.toObject());
            }
        } else {
            const data = readData();
            const user = data.users.find(u => u.id === userId);
            if (!user) return [];
            
            const subUserId = user.parentId || user.id;
            const sub = data.subscriptions && data.subscriptions.find(s => s.userId === subUserId);
            if (sub && new Date() > new Date(sub.expirationDate)) {
                return []; // Subscription expired
            }
            
            if (user.parentId) {
                return data.devices.filter(d => d.assignedTo && d.assignedTo.includes(userId));
            } else {
                return data.devices.filter(d => d.ownerId === userId);
            }
        }
    },
    togglePinDevice: async (userId, imei) => {
        await ensureDbConnected();
        imei = imei.trim();
        if (useMongo) {
            const device = await Device.findOne({
                imei,
                $or: [
                    { ownerId: userId },
                    { assignedTo: userId }
                ]
            });
            if (device) {
                device.pinned = !device.pinned;
                await device.save();
                return device.pinned;
            }
            return false;
        } else {
            const data = readData();
            const device = data.devices.find(d => d.imei === imei && (d.ownerId === userId || (d.assignedTo && d.assignedTo.includes(userId))));
            if (device) {
                device.pinned = !device.pinned;
                writeData(data);
                return device.pinned;
            }
            return false;
        }
    },
    getCustomerSubscription: async (userId) => {
        await ensureDbConnected();
        if (useMongo) {
            const sub = await Subscription.findOne({ userId });
            if (sub) {
                const expDate = new Date(sub.expirationDate);
                const daysLeft = Math.max(0, Math.ceil((expDate - new Date()) / (1000 * 60 * 60 * 24)));
                return {
                    userId: sub.userId,
                    planName: sub.planName,
                    deviceLimit: sub.deviceLimit,
                    pricePaid: sub.pricePaid,
                    validityDays: sub.validityDays,
                    expirationDate: sub.expirationDate.toISOString(),
                    daysLeft
                };
            }
            return null;
        } else {
            const data = readData();
            const sub = data.subscriptions.find(s => s.userId === userId);
            if (sub) {
                const expDate = new Date(sub.expirationDate);
                const daysLeft = Math.max(0, Math.ceil((expDate - new Date()) / (1000 * 60 * 60 * 24)));
                return {
                    userId: sub.userId,
                    planName: sub.planName || 'Trial',
                    deviceLimit: sub.deviceLimit || 1,
                    pricePaid: sub.pricePaid || 0,
                    validityDays: sub.validityDays,
                    expirationDate: sub.expirationDate,
                    daysLeft
                };
            }
            return null;
        }
    },

    // Telematics & LastSeen Updates
    updateDeviceLastSeen: async (imei, locationData) => {
        await ensureDbConnected();
        if (useMongo) {
            const dev = await Device.findOne({ imei });
            const initialOdo = dev ? (dev.initialOdometer || 0) : 0;
            const prevRecord = await DeviceLastSeen.findOne({ imei });
            
            let isExpired = false;
            if (dev && dev.ownerId) {
                const sub = await Subscription.findOne({ userId: dev.ownerId });
                if (sub && new Date() > new Date(sub.expirationDate)) {
                    isExpired = true;
                }
            }


            let status = 'offline';
            let ignitionOnTime = prevRecord ? prevRecord.ignitionOnTime : null;
            let ignitionOffTime = prevRecord ? prevRecord.ignitionOffTime : null;
            const now = new Date(locationData.timestamp);

            if (locationData.speed > 2) {
                status = 'running';
                ignitionOnTime = null;
                ignitionOffTime = null;
            } else {
                if (locationData.ignition === true) {
                    if (!prevRecord || prevRecord.ignition === false || !ignitionOnTime) {
                        ignitionOnTime = now;
                        ignitionOffTime = null;
                    }
                    const durationOn = ignitionOnTime ? (now - new Date(ignitionOnTime)) / 1000 : 0;
                    status = (durationOn >= 10) ? 'idle' : 'running';
                } else {
                    if (!prevRecord || prevRecord.ignition === true || prevRecord.ignition === undefined || !ignitionOffTime) {
                        ignitionOffTime = now;
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

            let finalLat = locationData.latitude;
            let finalLng = locationData.longitude;
            
            // If GPS is explicitly invalid OR coordinates are missing/zero, use fallback to last known valid location
            if (locationData.gpsValid === false || !finalLat || finalLat === 0 || !finalLng || finalLng === 0) {
                if (prevRecord && prevRecord.latitude && prevRecord.latitude !== 0 && prevRecord.longitude && prevRecord.longitude !== 0) {
                    finalLat = prevRecord.latitude;
                    finalLng = prevRecord.longitude;
                } else {
                    const lastValid = await DeviceHistoryPoint.findOne({ imei, latitude: { $nin: [0, null], $exists: true } }).sort({ timestamp: -1 });
                    if (lastValid) {
                        finalLat = lastValid.latitude;
                        finalLng = lastValid.longitude;
                    }
                }
            }

            // Ensure the in-memory object (which gets emitted to clients via sockets) 
            // is updated with the fallback coordinates so the map doesn't flicker to 0,0
            locationData.latitude = finalLat;
            locationData.longitude = finalLng;

            const point = {
                timestamp: now,
                latitude: finalLat,
                longitude: finalLng,
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

            await DeviceLastSeen.findOneAndUpdate(
                { imei },
                { $set: point },
                { upsert: true, new: true }
            );

            if (!isExpired && locationData.latitude && locationData.longitude && locationData.latitude !== 0 && locationData.longitude !== 0) {
                await DeviceHistoryPoint.create({
                    imei,
                    timestamp: point.timestamp,
                    latitude: point.latitude,
                    longitude: point.longitude,
                    speed: point.speed,
                    heading: point.heading,
                    satellites: point.satellites,
                    gpsValid: point.gpsValid,
                    battery: point.battery,
                    ignition: point.ignition,
                    packetType: point.packetType,
                    event: point.event,
                    odometer: point.odometer,
                    accumulatedDistance: point.accumulatedDistance,
                    rawHex: point.rawHex,
                    status: point.status,
                    ignitionOnTime: point.ignitionOnTime,
                    ignitionOffTime: point.ignitionOffTime,
                    powerSource: point.powerSource,
                    voltage: point.voltage
                });
            }
            return [];
        } else {
            const data = readData();
            const dev = data.devices.find(d => d.imei === imei);
            const initialOdo = dev ? (dev.initialOdometer || 0) : 0;
            const prevRecord = data.deviceLastSeen[imei];
            
            let isExpired = false;
            if (dev && dev.ownerId) {
                const owner = data.users.find(u => u.id === dev.ownerId);
                const subUserId = owner ? (owner.parentId || owner.id) : dev.ownerId;
                const sub = data.subscriptions && data.subscriptions.find(s => s.userId === subUserId);
                if (sub && new Date() > new Date(sub.expirationDate)) {
                    isExpired = true;
                }
            }

            let status = 'offline';
            let ignitionOnTime = prevRecord ? prevRecord.ignitionOnTime : null;
            let ignitionOffTime = prevRecord ? prevRecord.ignitionOffTime : null;
            const now = new Date(locationData.timestamp);

            if (locationData.speed > 2) {
                status = 'running';
                ignitionOnTime = null;
                ignitionOffTime = null;
            } else {
                if (locationData.ignition === true) {
                    if (!prevRecord || prevRecord.ignition === false || !ignitionOnTime) {
                        ignitionOnTime = now.toISOString();
                        ignitionOffTime = null;
                    }
                    const durationOn = ignitionOnTime ? (now - new Date(ignitionOnTime)) / 1000 : 0;
                    status = (durationOn >= 10) ? 'idle' : 'running';
                } else {
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

            let finalLat = locationData.latitude;
            let finalLng = locationData.longitude;
            if (!finalLat || finalLat === 0 || !finalLng || finalLng === 0) {
                if (prevRecord && prevRecord.latitude && prevRecord.latitude !== 0 && prevRecord.longitude && prevRecord.longitude !== 0) {
                    finalLat = prevRecord.latitude;
                    finalLng = prevRecord.longitude;
                } else {
                    const historyFile = path.join(__dirname, 'history', `${imei}.json`);
                    if (fs.existsSync(historyFile)) {
                        try {
                            const historyData = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
                            for (let i = historyData.length - 1; i >= 0; i--) {
                                if (historyData[i].latitude && historyData[i].latitude !== 0) {
                                    finalLat = historyData[i].latitude;
                                    finalLng = historyData[i].longitude;
                                    break;
                                }
                            }
                        } catch(e) {}
                    }
                }
            }

            // Ensure the in-memory object is updated with the fallback coordinates 
            // so the map doesn't flicker to 0,0
            locationData.latitude = finalLat;
            locationData.longitude = finalLng;

            const point = {
                timestamp: locationData.timestamp,
                latitude: finalLat,
                longitude: finalLng,
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
            writeData(data);

            if (!isExpired && locationData.latitude && locationData.longitude && locationData.latitude !== 0 && locationData.longitude !== 0) {
                const historyDir = path.join(__dirname, 'history');
                if (!fs.existsSync(historyDir)) {
                    fs.mkdirSync(historyDir, { recursive: true });
                }
                const historyFile = path.join(historyDir, `${imei}.json`);
                let deviceHistory = [];
                if (fs.existsSync(historyFile)) {
                    try {
                        const raw = fs.readFileSync(historyFile, 'utf8');
                        deviceHistory = JSON.parse(raw);
                    } catch (e) {
                        console.error("[Store] Failed to read history file:", e.message);
                    }
                } else {
                    if (data.deviceHistory && data.deviceHistory[imei]) {
                        deviceHistory = data.deviceHistory[imei];
                        delete data.deviceHistory[imei];
                    }
                }
                deviceHistory.push(point);
                if (deviceHistory.length > 100000) {
                    deviceHistory.shift();
                }
                try {
                    fs.writeFileSync(historyFile, JSON.stringify(deviceHistory), 'utf8');
                } catch (e) {
                    console.error("[Store] Failed to write history file:", e.message);
                }
            }

            writeData(data);
            return [];
        }
    },
    getHistory: async (imei) => {
        await ensureDbConnected();
        if (useMongo) {
            const list = await DeviceHistoryPoint.find({ imei }).sort({ timestamp: 1 });
            return list.map(p => ({
                timestamp: p.timestamp.toISOString(),
                latitude: p.latitude,
                longitude: p.longitude,
                speed: p.speed,
                heading: p.heading,
                satellites: p.satellites,
                gpsValid: p.gpsValid,
                battery: p.battery,
                ignition: p.ignition,
                packetType: p.packetType,
                event: p.event,
                odometer: p.odometer,
                accumulatedDistance: p.accumulatedDistance,
                rawHex: p.rawHex,
                status: p.status,
                ignitionOnTime: p.ignitionOnTime ? p.ignitionOnTime.toISOString() : null,
                ignitionOffTime: p.ignitionOffTime ? p.ignitionOffTime.toISOString() : null,
                powerSource: p.powerSource,
                voltage: p.voltage
            }));
        } else {
            const historyDir = path.join(__dirname, 'history');
            const historyFile = path.join(historyDir, `${imei}.json`);
            if (fs.existsSync(historyFile)) {
                try {
                    const raw = fs.readFileSync(historyFile, 'utf8');
                    return JSON.parse(raw);
                } catch (e) {
                    console.error("[Store] Failed to read history file:", e.message);
                }
            }
            const data = readData();
            return data.deviceHistory[imei] || [];
        }
    },

    // Geofencing
    getGeofences: async (userId) => {
        await ensureDbConnected();
        if (useMongo) {
            const list = await Geofence.find({ userId });
            return list.map(g => g.toObject());
        } else {
            const data = readData();
            return data.geofences.filter(g => g.userId === userId);
        }
    },
    addGeofence: async (geofence) => {
        await ensureDbConnected();
        if (useMongo) {
            geofence.id = Date.now().toString();
            const gf = await Geofence.create(geofence);
            return gf.toObject();
        } else {
            const data = readData();
            geofence.id = Date.now().toString();
            data.geofences.push(geofence);
            writeData(data);
            return geofence;
        }
    },
    deleteGeofence: async (id) => {
        await ensureDbConnected();
        if (useMongo) {
            const result = await Geofence.deleteOne({ id });
            return result.deletedCount > 0;
        } else {
            const data = readData();
            const initialLen = data.geofences.length;
            data.geofences = data.geofences.filter(g => g.id !== id);
            writeData(data);
            return data.geofences.length < initialLen;
        }
    },
    updateGeofence: async (id, updates) => {
        await ensureDbConnected();
        if (useMongo) {
            const gf = await Geofence.findOne({ id });
            if (gf) {
                Object.assign(gf, updates);
                await gf.save();
                return true;
            }
            return false;
        } else {
            const data = readData();
            const gf = data.geofences.find(g => g.id === id);
            if (gf) {
                Object.assign(gf, updates);
                writeData(data);
                return true;
            }
            return false;
        }
    },

    updateSubscriptionValidity: async (userId, extraDays) => {
        await ensureDbConnected();
        if (useMongo) {
            const sub = await Subscription.findOne({ userId });
            if (sub) {
                const currentDate = new Date(sub.expirationDate);
                currentDate.setDate(currentDate.getDate() + parseInt(extraDays));
                sub.expirationDate = currentDate;
                sub.validityDays += parseInt(extraDays);
                await sub.save();
                return true;
            }
            return false;
        } else {
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
        }
    },

    // KYC Applications
    createKycApplication: async (appData) => {
        await ensureDbConnected();
        if (useMongo) {
            await KycApplication.deleteMany({ userId: appData.userId, status: { $ne: 'verified' } });
            const kyc = await KycApplication.create({
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
                submittedAt: new Date()
            });
            return kyc.toObject();
        } else {
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
        }
    },
    getKycApplications: async () => {
        await ensureDbConnected();
        if (useMongo) {
            const list = await KycApplication.find({});
            const result = [];
            for (let k of list) {
                const u = await User.findOne({ id: k.userId });
                result.push({
                    ...k.toObject(),
                    username: u ? u.username : 'Unknown'
                });
            }
            return result;
        } else {
            const data = readData();
            return data.kycApplications.map(k => {
                const u = data.users.find(usr => usr.id === k.userId);
                return {
                    ...k,
                    username: u ? u.username : 'Unknown'
                };
            });
        }
    },
    getKycByUserId: async (userId) => {
        await ensureDbConnected();
        if (useMongo) {
            const k = await KycApplication.findOne({ userId });
            return k ? k.toObject() : null;
        } else {
            const data = readData();
            return data.kycApplications.find(k => k.userId === userId) || null;
        }
    },
    updateKycStatus: async (kycId, status, rejectReason = null) => {
        await ensureDbConnected();
        if (useMongo) {
            const kyc = await KycApplication.findOne({ id: kycId });
            if (!kyc) return false;
            kyc.status = status;
            kyc.reviewedAt = new Date();
            if (rejectReason) kyc.rejectReason = rejectReason;
            await kyc.save();
            return true;
        } else {
            const data = readData();
            const kyc = data.kycApplications.find(k => k.id === kycId);
            if (!kyc) return false;
            kyc.status = status;
            kyc.reviewedAt = new Date().toISOString();
            if (rejectReason) kyc.rejectReason = rejectReason;
            writeData(data);
            return true;
        }
    },

    // Settings
    getDeviceSettings: async (imei) => {
        await ensureDbConnected();
        if (useMongo) {
            const ds = await DeviceSettings.findOne({ imei });
            if (!ds) return defaultSettings;
            return { ...defaultSettings, ...Object.fromEntries(ds.settings) };
        } else {
            const data = readData();
            return { ...defaultSettings, ...(data.deviceSettings[imei] || {}) };
        }
    },
    updateDeviceSettings: async (imei, settings) => {
        await ensureDbConnected();
        if (useMongo) {
            let ds = await DeviceSettings.findOne({ imei });
            if (!ds) {
                ds = new DeviceSettings({ imei, settings: defaultSettings });
            }
            const currentSettings = Object.fromEntries(ds.settings);
            const mergedSettings = { ...currentSettings, ...settings };
            ds.settings = mergedSettings;
            await ds.save();
            return true;
        } else {
            const data = readData();
            data.deviceSettings[imei] = {
                ...(data.deviceSettings[imei] || defaultSettings),
                ...settings
            };
            writeData(data);
            return true;
        }
    },
    getUserSettings: async (userId) => {
        await ensureDbConnected();
        if (useMongo) {
            const us = await UserSettings.findOne({ userId });
            if (!us) return defaultSettings;
            return { ...defaultSettings, ...Object.fromEntries(us.settings) };
        } else {
            const data = readData();
            return { ...defaultSettings, ...(data.userSettings[userId] || {}) };
        }
    },
    updateUserSettings: async (userId, settings) => {
        await ensureDbConnected();
        if (useMongo) {
            let us = await UserSettings.findOne({ userId });
            if (!us) {
                us = new UserSettings({ userId, settings: defaultSettings });
            }
            const currentSettings = Object.fromEntries(us.settings);
            const mergedSettings = { ...currentSettings, ...settings };
            us.settings = mergedSettings;
            await us.save();
            return true;
        } else {
            const data = readData();
            data.userSettings[userId] = {
                ...(data.userSettings[userId] || defaultSettings),
                ...settings
            };
            writeData(data);
            return true;
        }
    },

    resetPassword: async (userId, newPassword) => {
        await ensureDbConnected();
        if (useMongo) {
            const user = await User.findOne({ id: userId });
            if (!user) return false;
            user.password = encrypt(newPassword);
            await user.save();
            return true;
        } else {
            const data = readData();
            const user = data.users.find(u => u.id === userId);
            if (!user) return false;
            user.password = encrypt(newPassword);
            writeData(data);
            return true;
        }
    },

    getSystemSettings: async () => {
        await ensureDbConnected();
        if (useMongo) {
            let settings = await SystemSettings.findOne({ key: 'pricing' });
            if (!settings) {
                settings = await SystemSettings.create({
                    key: 'pricing',
                    plans: {
                        'Trial': { name: 'Trial', price: 0, deviceLimit: 100, validityDays: 10 },
                        'Basic': { name: 'Basic', price: 99, deviceLimit: 2, validityDays: 30 },
                        'Standard': { name: 'Standard', price: 199, deviceLimit: 5, validityDays: 30 },
                        'Premium': { name: 'Premium', price: 399, deviceLimit: 15, validityDays: 30 },
                        'Enterprise': { name: 'Enterprise', price: 999, deviceLimit: 500, validityDays: 30 }
                    }
                });
            }
            return Object.fromEntries(settings.plans);
        } else {
            const data = readData();
            return data.systemSettings || defaultData.systemSettings;
        }
    },
    updateSystemSettings: async (plans) => {
        await ensureDbConnected();
        if (useMongo) {
            let settings = await SystemSettings.findOne({ key: 'pricing' });
            if (!settings) {
                settings = new SystemSettings({ key: 'pricing', plans: {} });
            }
            settings.plans = plans;
            await settings.save();
            return true;
        } else {
            const data = readData();
            data.systemSettings = plans;
            writeData(data);
            return true;
        }
    },
    getPayments: async () => {
        await ensureDbConnected();
        if (useMongo) {
            const list = await Payment.find({}).sort({ timestamp: -1 });
            return list.map(p => p.toObject());
        } else {
            const data = readData();
            return (data.payments || []).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
        }
    },
    getTotalIncome: async () => {
        await ensureDbConnected();
        if (useMongo) {
            const list = await Payment.find({});
            return list.reduce((sum, p) => sum + (p.amount || 0), 0);
        } else {
            const data = readData();
            return (data.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
        }
    },

    updateCustomerPlan: async (userId, planName, pricePaid, customDeviceLimit = null) => {
        await ensureDbConnected();
        if (useMongo) {
            const user = await User.findOne({ id: userId });
            if (!user) return null;

            let price = pricePaid;
            let validityDays = 30;
            let deviceLimit = 2;

            const pricing = await SystemSettings.findOne({ key: 'pricing' });
            if (pricing && pricing.plans && pricing.plans.get(planName)) {
                const planConfig = pricing.plans.get(planName);
                price = planConfig.price;
                validityDays = planConfig.validityDays;
                deviceLimit = planConfig.deviceLimit;
            }

            if (customDeviceLimit !== null && customDeviceLimit !== undefined && customDeviceLimit !== '') {
                deviceLimit = parseInt(customDeviceLimit);
            }

            let sub = await Subscription.findOne({ userId });
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
                sub.expirationDate = expirationDate;
                await sub.save();
            } else {
                expirationDate.setDate(expirationDate.getDate() + validityDays);
                sub = await Subscription.create({
                    userId,
                    planName,
                    deviceLimit,
                    pricePaid: price,
                    validityDays,
                    expirationDate
                });
            }

            await Payment.create({
                id: Date.now().toString() + Math.floor(Math.random() * 1000),
                userId,
                username: user.username,
                planName,
                amount: price,
                timestamp: new Date()
            });

            return {
                planName: sub.planName,
                deviceLimit: sub.deviceLimit,
                expirationDate: sub.expirationDate.toISOString(),
                validityDays: sub.validityDays,
                pricePaid: sub.pricePaid
            };
        } else {
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
        }
    },

    renameDevice: async (imei, userId, newName) => {
        await ensureDbConnected();
        if (useMongo) {
            const dev = await Device.findOne({
                imei,
                $or: [
                    { ownerId: userId },
                    { assignedTo: userId }
                ]
            });
            if (dev) {
                dev.name = newName;
                await dev.save();
                return true;
            }
            return false;
        } else {
            const data = readData();
            const dev = data.devices.find(d => d.imei === imei && (d.ownerId === userId || (d.assignedTo && d.assignedTo.includes(userId))));
            if (dev) {
                dev.name = newName;
                writeData(data);
                return true;
            }
            return false;
        }
    },
    deleteDevice: async (imei, userId) => {
        await ensureDbConnected();
        if (useMongo) {
            const dev = await Device.findOne({ imei, ownerId: userId });
            if (!dev) return false;
            await Device.deleteOne({ imei });
            await DeviceLastSeen.deleteOne({ imei });
            await DeviceHistoryPoint.deleteMany({ imei });
            await DeviceSettings.deleteOne({ imei });
            await SharedLink.deleteMany({ imei });
            await DeviceRequest.deleteMany({ imei });
            return true;
        } else {
            const data = readData();
            const devIndex = data.devices.findIndex(d => d.imei === imei && d.ownerId === userId);
            if (devIndex === -1) return false;
            data.devices.splice(devIndex, 1);
            if (data.deviceLastSeen[imei]) delete data.deviceLastSeen[imei];
            if (data.deviceHistory[imei]) delete data.deviceHistory[imei];
            if (data.deviceSettings[imei]) delete data.deviceSettings[imei];
            data.sharedLinks = data.sharedLinks.filter(l => l.imei !== imei);
            data.deviceRequests = data.deviceRequests.filter(r => r.imei !== imei);
            writeData(data);
            return true;
        }
    },
    updateDriver: async (imei, userId, driverName) => {
        await ensureDbConnected();
        if (useMongo) {
            const dev = await Device.findOne({
                imei,
                $or: [
                    { ownerId: userId },
                    { assignedTo: userId }
                ]
            });
            if (dev) {
                dev.driverName = driverName;
                await dev.save();
                return true;
            }
            return false;
        } else {
            const data = readData();
            const dev = data.devices.find(d => d.imei === imei && (d.ownerId === userId || (d.assignedTo && d.assignedTo.includes(userId))));
            if (dev) {
                dev.driverName = driverName;
                writeData(data);
                return true;
            }
            return false;
        }
    },
    updateVehicleProfile: async (imei, userId, vehicleProfile, initialOdometer) => {
        await ensureDbConnected();
        if (useMongo) {
            const dev = await Device.findOne({
                imei,
                $or: [
                    { ownerId: userId },
                    { assignedTo: userId }
                ]
            });
            if (dev) {
                const oldInitialOdo = dev.initialOdometer || 0;
                const newInitialOdo = parseFloat(initialOdometer || 0);
                dev.vehicleProfile = vehicleProfile;
                dev.initialOdometer = newInitialOdo;
                await dev.save();

                const prevRecord = await DeviceLastSeen.findOne({ imei });
                if (prevRecord) {
                    const accumulatedDistance = prevRecord.accumulatedDistance !== undefined ?
                        prevRecord.accumulatedDistance : Math.max(0, (prevRecord.odometer || 0) - oldInitialOdo);
                    prevRecord.accumulatedDistance = accumulatedDistance;
                    prevRecord.odometer = newInitialOdo + accumulatedDistance;
                    await prevRecord.save();
                } else {
                    await DeviceLastSeen.create({
                        imei,
                        timestamp: new Date(),
                        latitude: 0,
                        longitude: 0,
                        speed: 0,
                        packetType: 'INIT',
                        odometer: newInitialOdo,
                        accumulatedDistance: 0
                    });
                }
                return true;
            }
            return false;
        } else {
            const data = readData();
            const dev = data.devices.find(d => d.imei === imei && (d.ownerId === userId || (d.assignedTo && d.assignedTo.includes(userId))));
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
        }
    },

    createSharedLink: async (imei, durationMinutes) => {
        await ensureDbConnected();
        if (useMongo) {
            const id = Math.random().toString(36).substring(2, 18);
            const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);
            const link = await SharedLink.create({ id, imei, expiresAt });
            return link.toObject();
        } else {
            const data = readData();
            if (!data.sharedLinks) data.sharedLinks = [];
            const id = Math.random().toString(36).substring(2, 18);
            const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
            const link = { id, imei, expiresAt };
            data.sharedLinks.push(link);
            writeData(data);
            return link;
        }
    },
    getSharedLink: async (id) => {
        await ensureDbConnected();
        if (useMongo) {
            const link = await SharedLink.findOne({ id });
            if (link) {
                if (new Date() < new Date(link.expiresAt)) {
                    return link.toObject();
                } else {
                    await SharedLink.deleteOne({ id });
                }
            }
            return null;
        } else {
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
        }
    },
    updateCustomerSubscriptionAdmin: async (userId, deviceLimit, extraDays) => {
        await ensureDbConnected();
        if (useMongo) {
            let sub = await Subscription.findOne({ userId });
            if (sub) {
                sub.deviceLimit = parseInt(deviceLimit);
                if (parseInt(extraDays) > 0) {
                    const now = new Date();
                    const baseDate = sub.expirationDate > now ? sub.expirationDate : now;
                    baseDate.setDate(baseDate.getDate() + parseInt(extraDays));
                    sub.expirationDate = baseDate;
                    sub.validityDays = (sub.validityDays || 10) + parseInt(extraDays);
                }
                await sub.save();
                return sub.toObject();
            } else {
                const expirationDate = new Date();
                expirationDate.setDate(expirationDate.getDate() + parseInt(extraDays || 30));
                const newSub = await Subscription.create({
                    userId,
                    planName: 'Free',
                    deviceLimit: parseInt(deviceLimit || 100),
                    pricePaid: 0,
                    validityDays: parseInt(extraDays || 30),
                    expirationDate
                });
                return newSub.toObject();
            }
        } else {
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
    },

    createSubUser: async (parentId, username, password, phone = '', email = '') => {
        await ensureDbConnected();
        if (useMongo) {
            const exists = await User.findOne({ username });
            if (exists) return null;

            const userId = Date.now().toString();
            const newUser = await User.create({
                id: userId,
                parentId: parentId,
                username,
                password: encrypt(password),
                role: 'customer',
                phone: phone || '',
                email: email || ''
            });

            let trialDays = 10;
            let trialLimit = 100;
            try {
                const settings = await SystemSettings.findOne({ key: 'pricing' });
                if (settings && settings.plans && settings.plans.get('Trial')) {
                    const trialPlan = settings.plans.get('Trial');
                    trialDays = trialPlan.validityDays || 10;
                    trialLimit = trialPlan.deviceLimit || 100;
                }
            } catch (e) {
                console.error('[Database] Error reading Trial configs:', e);
            }

            const expirationDate = new Date();
            expirationDate.setDate(expirationDate.getDate() + trialDays);

            await Subscription.create({
                userId,
                planName: 'Trial',
                deviceLimit: trialLimit,
                pricePaid: 0,
                validityDays: trialDays,
                expirationDate
            });

            return { id: newUser.id, username: newUser.username, role: newUser.role, parentId: newUser.parentId };
        } else {
            const data = readData();
            if (data.users.find(u => u.username === username)) return null;

            const userId = Date.now().toString();
            const newUser = {
                id: userId,
                parentId: parentId,
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
            return { id: newUser.id, username: newUser.username, role: newUser.role, parentId: newUser.parentId };
        }
    },
    getSubUsers: async (parentId) => {
        await ensureDbConnected();
        if (useMongo) {
            const list = await User.find({ parentId });
            return list.map(u => ({ id: u.id, username: u.username, phone: u.phone, email: u.email }));
        } else {
            const data = readData();
            return data.users
                .filter(u => u.parentId === parentId)
                .map(u => ({ id: u.id, username: u.username, phone: u.phone, email: u.email }));
        }
    },
    assignDeviceToSubUser: async (imei, dealerId, subUserId, assign) => {
        await ensureDbConnected();
        if (useMongo) {
            const device = await Device.findOne({ imei });
            if (!device) return false;
            if (device.ownerId !== dealerId) return false;

            if (!device.assignedTo) {
                device.assignedTo = [];
            }
            if (assign) {
                if (!device.assignedTo.includes(subUserId)) {
                    device.assignedTo.push(subUserId);
                }
            } else {
                device.assignedTo = device.assignedTo.filter(id => id !== subUserId);
            }
            await device.save();
            return true;
        } else {
            const data = readData();
            const device = data.devices.find(d => d.imei === imei);
            if (!device) return false;
            if (device.ownerId !== dealerId) return false;

            if (!device.assignedTo) {
                device.assignedTo = [];
            }
            if (assign) {
                if (!device.assignedTo.includes(subUserId)) {
                    device.assignedTo.push(subUserId);
                }
            } else {
                device.assignedTo = device.assignedTo.filter(id => id !== subUserId);
            }
            writeData(data);
            return true;
        }
    }
};
