const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fleetly';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('[Database] Connected to MongoDB.'))
    .catch(err => {
        console.error('[Database] MongoDB Connection Error:', err);
        console.log('[Database] Retrying connection in 5 seconds...');
        setTimeout(() => {
            mongoose.connect(MONGODB_URI).catch(e => console.error('[Database] Retry failed:', e));
        }, 5000);
    });

// ── SCHEMAS & MODELS ──

// User Schema
const UserSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    username: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true },
    role: { type: String, required: true, default: 'customer' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' }
});

// Device Schema
const DeviceSchema = new mongoose.Schema({
    imei: { type: String, required: true, unique: true, index: true },
    ownerId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    pinned: { type: Boolean, default: false }
});

// Request Schema
const DeviceRequestSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    imei: { type: String, required: true },
    userId: { type: String, required: true },
    status: { type: String, default: 'pending' },
    timestamp: { type: Date, default: Date.now }
});

// Subscription Schema
const SubscriptionSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },
    planName: { type: String, required: true, default: 'Trial' },
    deviceLimit: { type: Number, required: true, default: 1 },
    pricePaid: { type: Number, required: true, default: 0 },
    validityDays: { type: Number, required: true, default: 10 },
    expirationDate: { type: Date, required: true }
});

// DeviceLastSeen Schema (Transient status)
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
    rawHex: { type: String, default: '' }
});

// DeviceHistoryPoint Schema (Scalable points collection)
const DeviceHistoryPointSchema = new mongoose.Schema({
    imei: { type: String, required: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    speed: { type: Number, required: true },
    odometer: { type: Number, default: 0 },
    rawHex: { type: String, default: '' }
});

// Geofence Schema
const GeofenceSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    type: { type: String, required: true }, // polygon or circle
    points: { type: [[Number]], required: true },
    radius: { type: Number, default: 0 }
});

// KYC Schema
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

// UserSettings Schema
const UserSettingsSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },
    settings: { type: Map, of: Boolean, default: {} }
});

// DeviceSettings Schema
const DeviceSettingsSchema = new mongoose.Schema({
    imei: { type: String, required: true, unique: true, index: true },
    settings: { type: Map, of: Boolean, default: {} }
});

// SystemSettings Schema (Configurable dynamic pricing)
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

// Payment Schema (Simulated Income Tracking)
const PaymentSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    username: { type: String, required: true },
    planName: { type: String, required: true },
    amount: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now }
});

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

// Seeding Default Admin and Pricing
async function bootstrapAdmin() {
    try {
        const count = await User.countDocuments();
        if (count === 0) {
            console.log('[Database] No users found. Seeding default admin...');
            const hashedPassword = await bcrypt.hash('password', 10);
            await User.create({
                id: '1',
                username: 'admin',
                password: hashedPassword,
                role: 'admin'
            });
            console.log('[Database] Default admin seeded.');
        }

        // Seed system settings (default pricing structure)
        const pricingExists = await SystemSettings.findOne({ key: 'pricing' });
        if (!pricingExists) {
            console.log('[Database] Seeding default pricing configurations...');
            await SystemSettings.create({
                key: 'pricing',
                plans: {
                    'Trial': { name: 'Trial', price: 0, deviceLimit: 1, validityDays: 10 },
                    'Basic': { name: 'Basic', price: 99, deviceLimit: 2, validityDays: 30 },
                    'Standard': { name: 'Standard', price: 199, deviceLimit: 5, validityDays: 30 },
                    'Premium': { name: 'Premium', price: 399, deviceLimit: 15, validityDays: 30 },
                    'Enterprise': { name: 'Enterprise', price: 999, deviceLimit: 500, validityDays: 30 }
                }
            });
            console.log('[Database] Default pricing configurations seeded.');
        }
    } catch(e) {
        console.error('[Database] Failed to bootstrap admin:', e);
    }
}
mongoose.connection.once('open', bootstrapAdmin);

// ── STORE EXPORTS ──

module.exports = {
    // Expose direct database queries if needed (like store.getData())
    getData: async () => {
        const devices = await Device.find({});
        const deviceLastSeen = {};
        const lastSeenList = await DeviceLastSeen.find({});
        lastSeenList.forEach(ls => {
            deviceLastSeen[ls.imei] = ls.toObject();
        });
        const deviceRequests = await DeviceRequest.find({});
        return { devices, deviceLastSeen, deviceRequests };
    },

    // Users
    getUser: async (username, password) => {
        const user = await User.findOne({ username });
        if (user && await bcrypt.compare(password, user.password)) {
            return { id: user.id, username: user.username, role: user.role };
        }
        return null;
    },
    getUserById: async (id) => {
        const user = await User.findOne({ id });
        if (user) {
            return { id: user.id, username: user.username, role: user.role };
        }
        return null;
    },
    getUserCredentials: async (userId) => {
        const user = await User.findOne({ id: userId });
        if (!user) return null;
        return {
            username: user.username,
            password: 'Protected (Bcrypt - use Reset Form)'
        };
    },
    createUser: async (username, password, phone = '', email = '') => {
        const exists = await User.findOne({ username });
        if (exists) return null; // Exists

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = Date.now().toString();
        const newUser = await User.create({
            id: userId,
            username,
            password: hashedPassword,
            role: 'customer',
            phone: phone || '',
            email: email || ''
        });

        let trialDays = 10;
        let trialLimit = 1;
        try {
            const pricing = await SystemSettings.findOne({ key: 'pricing' });
            if (pricing && pricing.plans) {
                const trialPlan = pricing.plans.get('Trial');
                if (trialPlan) {
                    trialDays = trialPlan.validityDays || 10;
                    trialLimit = trialPlan.deviceLimit || 1;
                }
            }
        } catch (e) {
            console.error('[Database] Error fetching trial settings:', e);
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
    },
    updateUserContact: async (userId, phone, email) => {
        const user = await User.findOne({ id: userId });
        if (!user) return false;
        if (phone !== undefined) user.phone = phone;
        if (email !== undefined) user.email = email;
        await user.save();
        return true;
    },
    getCustomerContact: async (userId) => {
        const user = await User.findOne({ id: userId });
        if (!user) return null;
        return { username: user.username, phone: user.phone || '', email: user.email || '' };
    },
    getAllCustomers: async () => {
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
    },

    // Admin Device Operations
    requestDevice: async (userId, imei) => {
        const user = await User.findOne({ id: userId });
        if (!user) return { error: 'User not found' };

        const deviceExists = await Device.findOne({ imei });
        if (deviceExists) return { error: 'Device is already registered' };

        const pendingRequest = await DeviceRequest.findOne({ imei, status: 'pending' });
        if (pendingRequest) return { error: 'A request is already pending for this device' };

        // Check device limit
        const activeDevicesCount = await Device.countDocuments({ ownerId: userId });
        const pendingCount = await DeviceRequest.countDocuments({ userId, status: 'pending' });
        const sub = await Subscription.findOne({ userId });
        const limit = sub ? (sub.deviceLimit || 1) : 1;

        if (activeDevicesCount + pendingCount >= limit) {
            return { error: `Device limit reached. Your current plan (${sub ? sub.planName : 'Trial'}) allows up to ${limit} device(s). Please upgrade your plan to register more devices!` };
        }

        const req = await DeviceRequest.create({
            id: Date.now().toString(),
            imei,
            userId,
            status: 'pending'
        });

        return req;
    },
    approveDeviceRequest: async (imei, userId) => {
        await DeviceRequest.deleteMany({ imei });
        const exists = await Device.findOne({ imei });
        if (!exists) {
            await Device.create({
                imei,
                ownerId: userId,
                name: 'New Asset'
            });
        }
        return true;
    },
    deleteCustomer: async (userId) => {
        await User.deleteOne({ id: userId });
        await Device.deleteMany({ ownerId: userId });
        await Subscription.deleteOne({ userId });
        await Geofence.deleteMany({ userId });
        await KycApplication.deleteMany({ userId });
        await UserSettings.deleteOne({ userId });
        return true;
    },
    updateContact: async (userId, phone, email) => {
        const user = await User.findOne({ id: userId });
        if (user) {
            user.phone = phone;
            user.email = email;
            await user.save();
            return true;
        }
        return false;
    },
    addSubscriptionDays: async (userId, days) => {
        let sub = await Subscription.findOne({ userId });
        if (!sub) {
            const expDate = new Date();
            expDate.setDate(expDate.getDate() + days);
            await Subscription.create({
                userId,
                validityDays: days,
                expirationDate: expDate
            });
            return true;
        }
        const currentExp = new Date(sub.expirationDate);
        const baseDate = currentExp > new Date() ? currentExp : new Date();
        baseDate.setDate(baseDate.getDate() + days);
        sub.expirationDate = baseDate;
        sub.validityDays += days;
        await sub.save();
        return true;
    },
    getPendingRequests: async () => {
        const pending = await DeviceRequest.find({ status: 'pending' });
        const list = [];
        for (let r of pending) {
            const ls = await DeviceLastSeen.findOne({ imei: r.imei });
            const u = await User.findOne({ id: r.userId });
            list.push({
                id: r.id,
                imei: r.imei,
                userId: r.userId,
                status: r.status,
                timestamp: r.timestamp.toISOString(),
                lastSeen: ls ? ls.toObject() : null,
                username: u ? u.username : 'Unknown'
            });
        }
        return list;
    },
    approveRequest: async (requestId) => {
        const req = await DeviceRequest.findOne({ id: requestId });
        if (!req || req.status !== 'pending') return false;

        req.status = 'approved';
        await req.save();

        const exists = await Device.findOne({ imei: req.imei });
        if (!exists) {
            await Device.create({
                imei: req.imei,
                ownerId: req.userId,
                name: `Device ${req.imei.slice(-4)}`
            });
        }
        return true;
    },
    rejectRequest: async (requestId) => {
        const result = await DeviceRequest.deleteOne({ id: requestId });
        return result.deletedCount > 0;
    },
    getCustomerDevices: async (userId) => {
        const list = await Device.find({ ownerId: userId });
        return list.map(d => d.toObject());
    },
    togglePinDevice: async (userId, imei) => {
        imei = imei.trim();
        const device = await Device.findOne({ ownerId: userId, imei });
        if (device) {
            device.pinned = !device.pinned;
            await device.save();
            return device.pinned;
        }
        return false;
    },
    getCustomerSubscription: async (userId) => {
        const sub = await Subscription.findOne({ userId });
        if (sub) {
            const expDate = new Date(sub.expirationDate);
            const daysLeft = Math.max(0, Math.ceil((expDate - new Date()) / (1000 * 60 * 60 * 24)));
            return {
                userId: sub.userId,
                validityDays: sub.validityDays,
                expirationDate: sub.expirationDate.toISOString(),
                daysLeft
            };
        }
        return null;
    },

    // Tracking Telemetry
    updateDeviceLastSeen: async (imei, locationData) => {
        const point = {
            timestamp: new Date(locationData.timestamp),
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

        // Update Last Seen document
        await DeviceLastSeen.findOneAndUpdate(
            { imei },
            { $set: point },
            { upsert: true, new: true }
        );

        // Store History Point
        await DeviceHistoryPoint.create({
            imei,
            timestamp: point.timestamp,
            latitude: point.latitude,
            longitude: point.longitude,
            speed: point.speed,
            odometer: point.odometer,
            rawHex: point.rawHex
        });

        // Limit history database points per device in development/mock to 500 records
        const count = await DeviceHistoryPoint.countDocuments({ imei });
        if (count > 500) {
            const oldest = await DeviceHistoryPoint.find({ imei }).sort({ timestamp: 1 }).limit(1);
            if (oldest.length > 0) {
                await DeviceHistoryPoint.deleteOne({ _id: oldest[0]._id });
            }
        }

        return []; // Return alerts array if needed
    },
    getHistory: async (imei) => {
        const list = await DeviceHistoryPoint.find({ imei }).sort({ timestamp: 1 });
        return list.map(p => ({
            timestamp: p.timestamp.toISOString(),
            latitude: p.latitude,
            longitude: p.longitude,
            speed: p.speed,
            odometer: p.odometer,
            rawHex: p.rawHex
        }));
    },

    // Geofences
    getGeofences: async (userId) => {
        const list = await Geofence.find({ userId });
        return list.map(g => g.toObject());
    },
    addGeofence: async (geofence) => {
        geofence.id = Date.now().toString();
        const gf = await Geofence.create(geofence);
        return gf.toObject();
    },
    deleteGeofence: async (id) => {
        const result = await Geofence.deleteOne({ id });
        return result.deletedCount > 0;
    },
    updateGeofence: async (id, updates) => {
        const gf = await Geofence.findOne({ id });
        if (gf) {
            Object.assign(gf, updates);
            await gf.save();
            return true;
        }
        return false;
    },

    updateSubscriptionValidity: async (userId, extraDays) => {
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
    },

    // KYC Applications
    createKycApplication: async (appData) => {
        // Remove existing application for same user if pending/rejected (status is not verified)
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
            status: 'under_review'
        });
        return kyc.toObject();
    },
    getKycApplications: async () => {
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
    },
    getKycByUserId: async (userId) => {
        const k = await KycApplication.findOne({ userId });
        return k ? k.toObject() : null;
    },
    updateKycStatus: async (kycId, status, rejectReason = null) => {
        const kyc = await KycApplication.findOne({ id: kycId });
        if (!kyc) return false;
        kyc.status = status;
        kyc.reviewedAt = new Date();
        if (rejectReason) kyc.rejectReason = rejectReason;
        await kyc.save();
        return true;
    },

    // Settings (Features list)
    getDeviceSettings: async (imei) => {
        const ds = await DeviceSettings.findOne({ imei });
        if (!ds) return defaultSettings;
        return { ...defaultSettings, ...Object.fromEntries(ds.settings) };
    },
    updateDeviceSettings: async (imei, settings) => {
        let ds = await DeviceSettings.findOne({ imei });
        if (!ds) {
            ds = new DeviceSettings({ imei, settings: defaultSettings });
        }
        const currentSettings = Object.fromEntries(ds.settings);
        const mergedSettings = { ...currentSettings, ...settings };
        ds.settings = mergedSettings;
        await ds.save();
        return true;
    },
    getUserSettings: async (userId) => {
        const us = await UserSettings.findOne({ userId });
        if (!us) return defaultSettings;
        return { ...defaultSettings, ...Object.fromEntries(us.settings) };
    },
    updateUserSettings: async (userId, settings) => {
        let us = await UserSettings.findOne({ userId });
        if (!us) {
            us = new UserSettings({ userId, settings: defaultSettings });
        }
        const currentSettings = Object.fromEntries(us.settings);
        const mergedSettings = { ...currentSettings, ...settings };
        us.settings = mergedSettings;
        await us.save();
        return true;
    },

    // Reset password
    resetPassword: async (userId, newPassword) => {
        const user = await User.findOne({ id: userId });
        if (!user) return false;
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        return true;
    },

    // System Settings (Pricing configuration)
    getSystemSettings: async () => {
        let settings = await SystemSettings.findOne({ key: 'pricing' });
        if (!settings) {
            // Seed fallback
            settings = await SystemSettings.create({
                key: 'pricing',
                plans: {
                    'Trial': { name: 'Trial', price: 0, deviceLimit: 1, validityDays: 10 },
                    'Basic': { name: 'Basic', price: 99, deviceLimit: 2, validityDays: 30 },
                    'Standard': { name: 'Standard', price: 199, deviceLimit: 5, validityDays: 30 },
                    'Premium': { name: 'Premium', price: 399, deviceLimit: 15, validityDays: 30 },
                    'Enterprise': { name: 'Enterprise', price: 999, deviceLimit: 500, validityDays: 30 }
                }
            });
        }
        return Object.fromEntries(settings.plans);
    },
    updateSystemSettings: async (plans) => {
        let settings = await SystemSettings.findOne({ key: 'pricing' });
        if (!settings) {
            settings = new SystemSettings({ key: 'pricing', plans: {} });
        }
        settings.plans = plans;
        await settings.save();
        return true;
    },

    // Subscriptions and Custom Pricing Upgrades
    updateCustomerPlan: async (userId, planName, pricePaid) => {
        const user = await User.findOne({ id: userId });
        if (!user) return null;

        // Fetch plan configuration from system settings
        let price = pricePaid;
        let validityDays = 30;
        let deviceLimit = 2;

        const pricing = await SystemSettings.findOne({ key: 'pricing' });
        if (pricing && pricing.plans && pricing.plans.get(planName)) {
            const planConfig = pricing.plans.get(planName);
            price = planConfig.price;
            validityDays = planConfig.validityDays;
            deviceLimit = planConfig.deviceLimit;
        } else {
            // Fallback just in case
            if (planName === 'Trial') { validityDays = 10; deviceLimit = 1; price = 0; }
            else if (planName === 'Basic') { validityDays = 30; deviceLimit = 2; price = 99; }
            else if (planName === 'Standard') { validityDays = 30; deviceLimit = 5; price = 199; }
            else if (planName === 'Premium') { validityDays = 30; deviceLimit = 15; price = 399; }
            else if (planName === 'Enterprise') { validityDays = 30; deviceLimit = 500; price = 999; }
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

        // Create a payment transaction record
        const paymentId = Date.now().toString() + Math.floor(Math.random() * 1000);
        await Payment.create({
            id: paymentId,
            userId,
            username: user.username,
            planName,
            amount: price
        });

        return {
            planName: sub.planName,
            deviceLimit: sub.deviceLimit,
            expirationDate: sub.expirationDate.toISOString(),
            validityDays: sub.validityDays,
            pricePaid: sub.pricePaid
        };
    },

    // Simulated Payments Log
    getPayments: async () => {
        return await Payment.find({}).sort({ timestamp: -1 });
    },
    getTotalIncome: async () => {
        const list = await Payment.find({});
        return list.reduce((sum, p) => sum + (p.amount || 0), 0);
    }
};
