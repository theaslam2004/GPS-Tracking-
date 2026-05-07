const net = require('net');
const fs = require('fs');
const path = require('path');

const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 8080;
const DATA_FILE = path.join(__dirname, 'data.json');

function generatePacket(imei, speed, lat, lng, isPanic = false) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB').replace(/\//g, ''); // DDMMYYYY
    const timeStr = now.toLocaleTimeString('en-GB').replace(/:/g, ''); // HHMMSS
    
    // Packet Type: NR (Normal), EA (Emergency/Panic)
    const type = isPanic ? 'EA' : 'NR';
    const ign = speed > 0 ? '1' : '0';
    
    // Mock Bharat-101 Packet
    return `$Header,iTriangle1,010013,${type},1,L,${imei},KA01GPS,${ign},${dateStr},${timeStr},${lat},N,${lng},E,${speed}.0,180.0,12,1,1,14.2,4.10,0,0,0,1,${(Math.random()*5000).toFixed(2)}*FF\r\n`;
}

async function startSimulation() {
    if (!fs.existsSync(DATA_FILE)) {
        console.error("data.json not found!");
        return;
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const devices = data.devices || [];

    if (devices.length === 0) {
        console.warn("No devices found. Add a device in the dashboard to simulate data.");
        return;
    }

    console.log(`\n🚀 [FLEET SIMULATOR] Starting live data feed for ${devices.length} devices...`);
    console.log(`📍 Connecting to ${SERVER_HOST}:${SERVER_PORT}\n`);

    devices.forEach((device, index) => {
        const client = new net.Socket();
        
        // Starting position near Bangalore
        let lat = 12.9716 + (index * 0.01);
        let lng = 77.5946 + (index * 0.01);

        client.connect(SERVER_PORT, SERVER_HOST, () => {
            console.log(`✅ [${device.imei}] Linked to server.`);
            
            setInterval(() => {
                // Simulate driving behavior
                const speed = Math.random() > 0.3 ? Math.floor(Math.random() * 110) : 0;
                
                // Panic simulation (1% chance)
                const isPanic = Math.random() < 0.01;
                
                // Move the vehicle slightly
                if (speed > 0) {
                    lat += (Math.random() - 0.5) * 0.001;
                    lng += (Math.random() - 0.5) * 0.001;
                }

                const packet = generatePacket(device.imei, speed, lat.toFixed(6), lng.toFixed(6), isPanic);
                client.write(packet);
                
                if (isPanic) console.log(`🚨 [${device.imei}] PANIC ALERT SENT!`);
            }, 3000 + (index * 500)); // Staggered updates
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
