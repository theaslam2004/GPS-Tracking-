const net = require('net');

const TCP_PORT = 8080;
const HOST = '127.0.0.1';

const client = new net.Socket();

client.connect(TCP_PORT, HOST, () => {
    console.log(`Connected to tracker server at ${HOST}:${TCP_PORT}`);
    
    // Base coordinates (New Delhi)
    let lat = 28.6139;
    let lng = 77.2090;

    // Send a mock GPS packet every 3 seconds
    setInterval(() => {
        // Move slightly to simulate driving
        lat += (Math.random() - 0.5) * 0.001;
        lng += (Math.random() - 0.5) * 0.001;
        const speed = Math.floor(Math.random() * 50) + 10;
        
        // Custom simple protocol for simulator: SIM,IMEI,LAT,LNG,SPEED
        const payload = `SIM,123412341234123,${lat.toFixed(6)},${lng.toFixed(6)},${speed}`;
        
        // In reality, a device sends binary data. We can send raw bytes:
        const buffer = Buffer.from(payload);
        
        client.write(buffer);
        console.log(`Simulated data sent: ${payload}`);
        
    }, 3000);
});

client.on('error', (err) => {
    console.error(`Simulator Connection Error: ${err.message}`);
    console.log("Make sure the server is running on port 8080 first!");
});

client.on('close', () => {
    console.log('Connection closed');
});
