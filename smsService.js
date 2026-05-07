/**
 * Fleetly GPS — Production SMS Alert Service
 * Provider: Fast2SMS (Best for Indian Transactional Alerts)
 * 
 * In a real product:
 * 1. Use 'Service Implicit' route for DLT-approved templates.
 * 2. Use 'Quick Route' for immediate testing/non-critical alerts.
 */

const axios = require('axios');

let config;
try {
    config = require('./email.config.json');
} catch (e) {
    config = { sms: { enabled: false } };
}

const SMS_API_URL = 'https://www.fast2sms.com/dev/bulkV2';
const smsConfig = config.sms || {};
const isSmsEnabled = smsConfig.enabled && smsConfig.apiKey && !smsConfig.apiKey.includes('YOUR_');

if (isSmsEnabled) {
    console.log(`[SMS] Fast2SMS Production Service INITIALIZED ✅ (Phone alerts active)`);
} else {
    console.log(`[SMS] Service PENDING ⚠️ (Update email.config.json with Fast2SMS API Key)`);
}

/**
 * Core Sending Engine
 * @param {string} phone - 10-digit mobile number
 * @param {string} message - Alert text
 */
async function dispatchSMS(phone, message) {
    // 1. Validation
    if (!phone) return;
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    if (cleanPhone.length !== 10) {
        console.error(`[SMS] ❌ Dropped: Invalid Indian phone format: ${phone}`);
        return;
    }

    // 2. Simulated Mode (If no API Key)
    if (!isSmsEnabled) {
        console.log(`\n[SMS-SIMULATOR] 📱 To: ${cleanPhone}`);
        console.log(`[SMS-SIMULATOR] 📝 Msg: ${message}`);
        console.log(`-----------------------------------------------\n`);
        return;
    }

    // 3. Real Production Dispatch
    try {
        const response = await axios({
            method: 'post',
            url: SMS_API_URL,
            timeout: 10000, // 10s timeout
            headers: {
                'authorization': smsConfig.apiKey,
                'Content-Type': 'application/json'
            },
            data: {
                route: 'q', // Quick route (Works without DLT approval for testing)
                message: message,
                language: 'english',
                flash: 0,
                numbers: cleanPhone
            }
        });

        if (response.data && response.data.return) {
            console.log(`[SMS] ✅ Alert delivered to ${cleanPhone} [RequestID: ${response.data.request_id}]`);
        } else {
            console.error(`[SMS] ⚠️ Provider Error: ${JSON.stringify(response.data)}`);
        }
    } catch (err) {
        const errMsg = err.response?.data?.message || err.message;
        console.error(`[SMS] ❌ Network/Auth Error: ${errMsg}`);
    }
}

// ─── Production Alert Templates ──────────────────────────────────────────────

const AlertService = {
    // 🆘 Critical: Panic Button
    sendPanic: (phone, vehicle) => {
        const msg = `🆘 FLEETLY ALERT: PANIC pressed in ${vehicle}. Check live location immediately!`;
        dispatchSMS(phone, msg);
    },

    // 🟢 Geofence Entry
    sendGeofenceEnter: (phone, vehicle, zone) => {
        const msg = `🟢 FLEETLY: ${vehicle} has ENTERED ${zone}.`;
        dispatchSMS(phone, msg);
    },

    // 🟠 Geofence Exit
    sendGeofenceExit: (phone, vehicle, zone) => {
        const msg = `🟠 FLEETLY: ${vehicle} has EXITED ${zone}.`;
        dispatchSMS(phone, msg);
    },

    // ⚠️ Harsh Driving
    sendSafetyAlert: (phone, vehicle, type) => {
        let eventName = "Harsh Driving";
        if (type === 'HB') eventName = "Harsh Braking";
        if (type === 'HA') eventName = "Harsh Accel";
        if (type === 'RT') eventName = "Rash Turning";
        
        const msg = `⚠️ FLEETLY SAFETY: ${eventName} detected on ${vehicle}. Drive safe!`;
        dispatchSMS(phone, msg);
    },

    // 🔴 Hardware Tamper
    sendTamperAlert: (phone, vehicle) => {
        const msg = `🔴 FLEETLY SECURITY: Device TAMPER detected on ${vehicle}. Check wiring.`;
        dispatchSMS(phone, msg);
    }
};

module.exports = AlertService;
