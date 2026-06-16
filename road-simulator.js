const net = require('net');
const fs = require('fs');
const path = require('path');

const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 8080;
const HISTORY_FILE = path.join(__dirname, 'history', '862170070000001.json');

function updatePacketTime(rawHex) {
    if (!rawHex) return null;
    const partsAsterisk = rawHex.split('*');
    const mainContent = partsAsterisk[0];
    const checksum = partsAsterisk[1] || 'FF\r\n';
    const parts = mainContent.split(',');
    
    // Find N/S indicator to position relative date and time strings
    const latDirIndex = parts.findIndex(p => p === 'N' || p === 'S');
    if (latDirIndex > 2) {
        const now = new Date();
        const day = String(now.getUTCDate()).padStart(2, '0');
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const year = String(now.getUTCFullYear());
        const dateStr = `${day}${month}${year}`;
        
        const hours = String(now.getUTCHours()).padStart(2, '0');
        const mins = String(now.getUTCMinutes()).padStart(2, '0');
        const secs = String(now.getUTCSeconds()).padStart(2, '0');
        const timeStr = `${hours}${mins}${secs}`;
        
        parts[latDirIndex - 3] = dateStr;
        parts[latDirIndex - 2] = timeStr;
    }
    

    // Check if packet ends with \r\n, otherwise append it
    let suffix = '*' + checksum;
    if (!suffix.endsWith('\r\n')) {
        suffix += '\r\n';
    }
    
    return parts.join(',') + suffix;
}

function startSimulator() {
    if (!fs.existsSync(HISTORY_FILE)) {
        console.error(`[Road Simulator] History file not found: ${HISTORY_FILE}`);
        return;
    }

    console.log('[Road Simulator] Reading pre-recorded road coordinates...');
    const points = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    console.log(`[Road Simulator] Loaded ${points.length} coordinates for playback.`);

    let index = 0;
    let client = null;

    function connectToServer() {
        console.log(`[Road Simulator] Connecting to local GPS server at ${SERVER_HOST}:${SERVER_PORT}...`);
        client = new net.Socket();

        client.connect(SERVER_PORT, SERVER_HOST, () => {
            console.log('✅ [Road Simulator] Connected to server. Beginning road playback stream...');
            
            // Loop points interval
            const intervalId = setInterval(() => {
                if (index >= points.length) {
                    index = 0; // Loop back to start
                }
                
                const pt = points[index];
                const rawPacket = updatePacketTime(pt.rawHex);
                
                if (rawPacket) {
                    client.write(rawPacket, (err) => {
                        if (err) {
                            console.error(`[Road Simulator] Error sending packet: ${err.message}`);
                        } else {
                            console.log(`[Road Simulator] [${index + 1}/${points.length}] Sent: Lat=${pt.latitude.toFixed(6)}, Lng=${pt.longitude.toFixed(6)}, Speed=${pt.speed} km/h, Ignition=${pt.ignition ? 'ON' : 'OFF'}, Event=${pt.event || 'None'}`);
                        }
                    });
                }
                
                index++;
            }, 2000);

            client.on('close', () => {
                console.log('🔌 [Road Simulator] Server connection closed. Cleaning up interval...');
                clearInterval(intervalId);
                setTimeout(connectToServer, 5000); // Reconnect in 5s
            });
        });

        client.on('error', (err) => {
            console.error(`❌ [Road Simulator] Connection error: ${err.message}`);
            client.destroy();
            setTimeout(connectToServer, 5000); // Retry in 5s
        });
    }

    connectToServer();
}

startSimulator();
