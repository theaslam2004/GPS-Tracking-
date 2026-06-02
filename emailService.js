// ============================================================
// Fleetly GPS — Email Alert Service
// Sends alert emails to customers for geofence & panic events
// Config: email.config.json or environment variables
// ============================================================

const nodemailer = require('nodemailer');
let config;
try {
    config = require('./email.config.json');
} catch(e) {
    config = {};
}

// SMTP configurations with environment variables fallback
const smtpEnabled = process.env.SMTP_ENABLED ? (process.env.SMTP_ENABLED === 'true') : (config.email ? config.email.enabled : false);
const smtpHost = process.env.SMTP_HOST || (config.email && config.email.smtp ? config.email.smtp.host : '');
const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : (config.email && config.email.smtp ? config.email.smtp.port : 587);
const smtpSecure = process.env.SMTP_SECURE ? (process.env.SMTP_SECURE === 'true') : (config.email && config.email.smtp ? config.email.smtp.secure : false);
const smtpUser = process.env.SMTP_USER || (config.email && config.email.smtp ? config.email.smtp.user : '');
const smtpPass = process.env.SMTP_PASS || (config.email && config.email.smtp ? config.email.smtp.pass : '');
const smtpFrom = process.env.SMTP_FROM || (config.email ? config.email.from : 'Fleetly GPS Alerts <no-reply@fleetly.com>');

let transporter = null;

if (smtpEnabled && smtpHost) {
    transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
            user: smtpUser,
            pass: smtpPass
        }
    });
    transporter.verify((err) => {
        if (err) console.error('[EMAIL] SMTP connection failed:', err.message);
        else console.log('[EMAIL] SMTP ready — alert emails enabled.');
    });
} else {
    console.log('[EMAIL] Email alerts disabled. Configure environment variables or email.config.json to enable.');
}

// ---------------------------------------------------------------
// Send a generic alert email
// ---------------------------------------------------------------
async function sendAlert({ to, subject, html }) {
    if (!transporter || !to) return;
    try {
        await transporter.sendMail({ from: smtpFrom, to, subject, html });
        console.log(`[EMAIL] Alert sent to: ${to} | Subject: ${subject}`);
    } catch(e) {
        console.error(`[EMAIL] Failed to send to ${to}:`, e.message);
    }
}

// ---------------------------------------------------------------
// Geofence Alert Email
// ---------------------------------------------------------------
function sendGeofenceAlert({ email, customerName, deviceName, imei, type, geofenceName, timestamp }) {
    const isEntry = type === 'geofence_enter';
    const actionWord = isEntry ? 'entered' : 'exited';
    const iconColor = isEntry ? '#00E676' : '#FF7300';
    const icon = isEntry ? '🟢' : '🟠';

    const subject = `${icon} Fleet Alert: ${deviceName} ${actionWord} "${geofenceName}"`;
    const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; background: #0a0d14; color: #fff; padding: 32px; max-width: 600px; margin: 0 auto; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
        <div style="text-align:center; margin-bottom: 24px;">
            <div style="font-size: 2.5rem; margin-bottom: 8px;">${icon}</div>
            <h1 style="margin:0; font-size: 1.4rem; color: ${iconColor};">Geofence ${isEntry ? 'Entry' : 'Exit'} Alert</h1>
        </div>
        <div style="background: rgba(255,255,255,0.04); border-radius: 8px; padding: 20px; border: 1px solid rgba(255,255,255,0.08); margin-bottom: 20px;">
            <p style="margin: 0 0 12px; font-size: 1rem;">Hello <strong>${customerName || 'Customer'}</strong>,</p>
            <p style="margin: 0; color: #8b9bb4;">Your vehicle <strong style="color:#fff;">${deviceName}</strong> (IMEI: <code style="color:#00D4FF;">${imei}</code>) has <strong style="color:${iconColor};">${actionWord}</strong> the geofence zone:</p>
        </div>
        <div style="background: rgba(0,212,255,0.08); border-radius: 8px; padding: 16px 20px; border-left: 4px solid ${iconColor}; margin-bottom: 24px;">
            <div style="font-size: 1.2rem; font-weight: 700; color: #fff;">📍 ${geofenceName}</div>
            <div style="font-size: 0.85rem; color: #8b9bb4; margin-top: 6px;">Time: ${new Date(timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</div>
        </div>
        <p style="color: #8b9bb4; font-size: 0.8rem; text-align:center; margin:0;">This is an automated alert from <strong style="color:#00D4FF;">Fleetly GPS</strong>. Do not reply to this email.</p>
    </div>`;

    sendAlert({ to: email, subject, html });
}

// ---------------------------------------------------------------
// Panic / SOS Alert Email
// ---------------------------------------------------------------
function sendPanicAlert({ email, customerName, deviceName, imei, lat, lng, timestamp }) {
    const mapsLink = (lat && lng) ? `https://maps.google.com/?q=${lat},${lng}` : null;
    const subject = `🆘 PANIC ALERT: ${deviceName} triggered SOS!`;
    const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; background: #0a0d14; color: #fff; padding: 32px; max-width: 600px; margin: 0 auto; border-radius: 12px; border: 2px solid #FF3D00;">
        <div style="text-align:center; margin-bottom: 24px; background: rgba(255,61,0,0.15); padding: 20px; border-radius: 8px;">
            <div style="font-size: 3rem; margin-bottom: 8px;">🆘</div>
            <h1 style="margin:0; font-size: 1.6rem; color: #FF3D00;">PANIC / SOS ALERT</h1>
            <p style="margin: 8px 0 0; color: #8b9bb4;">Emergency button pressed on your vehicle</p>
        </div>
        <div style="background: rgba(255,255,255,0.04); border-radius: 8px; padding: 20px; border: 1px solid rgba(255,61,0,0.3); margin-bottom: 20px;">
            <p style="margin: 0 0 12px;">Hello <strong>${customerName || 'Customer'}</strong>,</p>
            <p style="margin: 0; color: #8b9bb4;">The panic/SOS button was pressed on vehicle <strong style="color:#fff;">${deviceName}</strong> (IMEI: <code style="color:#FF3D00;">${imei}</code>).</p>
        </div>
        <table style="width:100%; border-collapse:collapse; margin-bottom: 20px;">
            <tr>
                <td style="padding: 10px; color: #8b9bb4; font-size:0.85rem;">📅 Time</td>
                <td style="padding: 10px; font-weight:600;">${new Date(timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</td>
            </tr>
            ${lat && lng ? `
            <tr style="background:rgba(255,255,255,0.03);">
                <td style="padding: 10px; color: #8b9bb4; font-size:0.85rem;">📍 Location</td>
                <td style="padding: 10px; font-weight:600;">${lat.toFixed(5)}, ${lng.toFixed(5)}</td>
            </tr>` : ''}
        </table>
        ${mapsLink ? `
        <div style="text-align:center; margin-bottom: 24px;">
            <a href="${mapsLink}" style="display:inline-block; background: #FF3D00; color:#fff; text-decoration:none; padding: 12px 28px; border-radius: 8px; font-weight:700; font-size:1rem;">📍 View Location on Maps</a>
        </div>` : ''}
        <p style="color: #8b9bb4; font-size: 0.8rem; text-align:center; margin:0;">This is an automated emergency alert from <strong style="color:#00D4FF;">Fleetly GPS</strong>.</p>
    </div>`;

    sendAlert({ to: email, subject, html });
}

module.exports = { sendGeofenceAlert, sendPanicAlert };
