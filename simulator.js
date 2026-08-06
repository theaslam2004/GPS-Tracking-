const net = require('net');
const fs = require('fs');
const path = require('path');

const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 8080;
const DATA_FILE = path.join(__dirname, 'data.json');

function generatePacket(imei, speed, lat, lng, eventType = 'NR', vehicleProfile = 'standard') {
    const now = new Date();
    const day = String(now.getUTCDate()).padStart(2, '0');
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const year = String(now.getUTCFullYear());
    const dateStr = `${day}${month}${year}`;

    const hours = String(now.getUTCHours()).padStart(2, '0');
    const mins = String(now.getUTCMinutes()).padStart(2, '0');
    const secs = String(now.getUTCSeconds()).padStart(2, '0');
    const timeStr = `${hours}${mins}${secs}`;

    // Ignition is 1 if speed > 0 or if eventType is IN (Ignition On), except during Towing
    let ign = (speed > 0 && eventType !== 'TS' && eventType !== 'TE' || eventType === 'IN') ? '1' : '0';
    if (eventType === 'IF') ign = '0';

    const isPanic = (eventType === 'EA');
    const isTamper = (eventType === 'TA' || eventType === 'DT');
    const mainPower = (eventType === 'BD') ? '0' : '1';

    // Internal battery voltage: low battery if BL event, else normal
    const batVolt = (eventType === 'BL') ? '3.45' : '4.12';

    // Determine Alert ID dynamically matching the iTriangle spec
    let alertId = 1;
    switch (eventType) {
        case 'NR': alertId = 1; break;
        case 'EA': alertId = 10; break;
        case 'TA': alertId = 9; break;
        case 'HP': alertId = 1; break;
        case 'IN': alertId = 7; break;
        case 'IF': alertId = 8; break;
        case 'BD': alertId = 3; break;
        case 'BR': alertId = 6; break;
        case 'BL': alertId = 4; break;
        case 'HB': alertId = 13; break;
        case 'HA': alertId = 14; break;
        case 'RT': alertId = 15; break;
        case 'TS': alertId = 52; break;
        case 'TE': alertId = 53; break;
        case 'DT': alertId = 16; break;
    }

    // Determine vehicle main power voltage based on profile
    let mainVolt = '12.4';
    if (vehicleProfile === 'heavy') {
        mainVolt = '48.6';
    } else if (imei === '862170070000002') {
        mainVolt = '24.4'; // 24V standard vehicle
    }

    // Standard Bharat-101 Packet structure (indices align with real manual)
    return `$Header,iTriangle1,010013,${eventType},${alertId},L,${imei},KA01GPS,1,${dateStr},${timeStr},${lat},N,${lng},E,${speed}.0,180.0,12,206.0,1.26,0.68,Airtel,${ign},${mainPower},${mainVolt},${batVolt},${isPanic ? '1' : '0'},${isTamper ? 'O' : 'C'},31,404,10,8ab,975e416,45,ab,de74335,38,8ab,e09c934,43,8ab,951a834,0000,0001,008273,0.0,0.0,${(Math.random() * 5000).toFixed(2)}*FF\r\n`;
}

async function startSimulation() {
    if (!fs.existsSync(DATA_FILE)) {
        console.error("data.json not found!");
        return;
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const simulatorUser = (data.users || []).find(u => u.username === 'simulator');
    const simulatorUserId = simulatorUser ? simulatorUser.id : null;

    const devices = (data.devices || []).filter(d => {
        return simulatorUserId && d.ownerId === simulatorUserId;
    });

    if (devices.length === 0) {
        console.warn("No simulator devices found for user 'simulator'.");
        return;
    }

    console.log(`\n🚀 [FLEET SIMULATOR] Starting live data feed for ${devices.length} devices...`);
    console.log(`📍 Connecting to ${SERVER_HOST}:${SERVER_PORT}\n`);
    devices.forEach((device, index) => {
        const client = new net.Socket();

        // Starting position near Gujarat
        let lat = 22.566216 + (index * 0.01);
        let lng = 71.8072 + (index * 0.01);
        let prevSpeed = 0;
        let isTowed = false;
        let towingTicks = 0;

        client.connect(SERVER_PORT, SERVER_HOST, () => {
            console.log(`✅ [${device.imei}] Linked to server.`);

            setInterval(() => {
                let speed = 0;
                let eventType = 'NR';

                if (isTowed) {
                    towingTicks--;
                    if (towingTicks <= 0) {
                        isTowed = false;
                        speed = 0;
                        eventType = 'TE'; // Towing Stopped (Alert ID 53)
                    } else {
                        speed = Math.floor(Math.random() * 15) + 15; // 15-30 km/h towing speed
                        eventType = 'NR';
                    }
                } else {
                    // 75% chance vehicle is moving normally
                    if (Math.random() > 0.25) {
                        speed = Math.floor(Math.random() * 85) + 15;

                        // Harsh Braking (speed drops suddenly by more than 35)
                        if (prevSpeed - speed > 35) {
                            eventType = 'HB';
                        }
                        // Harsh Acceleration (speed jumps suddenly by more than 35)
                        else if (speed - prevSpeed > 35) {
                            eventType = 'HA';
                        }
                        // Rash Turning (10% chance when moving)
                        else if (Math.random() < 0.1) {
                            eventType = 'RT';
                        }
                    } else {
                        speed = 0;
                        if (prevSpeed > 0 && Math.random() < 0.5) {
                            eventType = 'IF'; // Ignition Off
                        } else if (prevSpeed === 0 && Math.random() < 0.015) {
                            // 1.5% chance to start being towed when stationary with ignition OFF
                            isTowed = true;
                            towingTicks = Math.floor(Math.random() * 4) + 3; // 3 to 6 ticks
                            speed = Math.floor(Math.random() * 15) + 15;
                            eventType = 'TS'; // Towing Started (Alert ID 52)
                        }
                    }

                    // Ignition On if stationary to moving normally
                    if (!isTowed && prevSpeed === 0 && speed > 0) {
                        eventType = 'IN';
                    }
                }

                prevSpeed = speed;

                // Random Alert Packets simulation disabled for clean demo
                /*
                if (!isTowed && eventType === 'NR') {
                    const r = Math.random();
                    if (r < 0.006) {
                        eventType = 'EA'; // Panic Alert (Emergency)
                    } else if (r < 0.012 && r >= 0.006) {
                        eventType = 'TA'; // Tamper Alert
                    } else if (r < 0.018 && r >= 0.012) {
                        eventType = 'BD'; // Main Battery Disconnect
                    } else if (r < 0.024 && r >= 0.018) {
                        eventType = 'BL'; // Internal Battery Low
                    }
                }
                */

                if (speed > 0) {
                    lat += (Math.random() - 0.5) * 0.001;
                    lng += (Math.random() - 0.5) * 0.001;
                }

                const packet = generatePacket(device.imei, speed, lat.toFixed(6), lng.toFixed(6), eventType, device.vehicleProfile || 'standard');
                client.write(packet);

                if (eventType !== 'NR') {
                    console.log(`🚨 [${device.imei}] Sent Event Packet: ${eventType} (Speed: ${speed} km/h)`);
                }
            }, 1500);
        });

        client.on('error', (err) => {
            console.error(`❌ [${device.imei}] Connection failed: ${err.message}`);
        });

        client.on('close', () => {
            console.log(`🔌 [${device.imei}] Connection closed.`);
        });
    });
}

// Initial delay to ensure server is ready
setTimeout(startSimulation, 2000);
