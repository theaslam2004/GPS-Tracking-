const net = require('net');

const TCP_PORT = 8080;
const HOST = '127.0.0.1';

const client = new net.Socket();

client.connect(TCP_PORT, HOST, () => {
    console.log(`Connected to tracker server at ${HOST}:${TCP_PORT}`);
    
    // Base coordinates (New Delhi)
    let lat1 = 28.6139;
    let lng1 = 77.2090;
    
    // Base coordinates (Mumbai)
    let lat2 = 19.0760;
    let lng2 = 72.8777;

    // Send a mock GPS packet every 3 seconds
    setInterval(() => {
        // Vehicle 1
        lat1 += (Math.random() - 0.5) * 0.001;
        lng1 += (Math.random() - 0.5) * 0.001;
        const speed1 = Math.floor(Math.random() * 50) + 10;
        const payload1 = `SIM,123412341234123,${lat1.toFixed(6)},${lng1.toFixed(6)},${speed1}`;
        client.write(Buffer.from(payload1));
        console.log(`Simulated data sent: ${payload1}`);
        
        // Vehicle 2
        lat2 += (Math.random() - 0.5) * 0.001;
        lng2 += (Math.random() - 0.5) * 0.001;
        // Make vehicle 2 sometimes idle (speed 0)
        const speed2 = Math.random() > 0.3 ? Math.floor(Math.random() * 80) + 20 : 0;
        const payload2 = `SIM,987654321098765,${lat2.toFixed(6)},${lng2.toFixed(6)},${speed2}`;
        client.write(Buffer.from(payload2));
        console.log(`Simulated data sent: ${payload2}`);
        
    }, 3000);
});

client.on('error', (err) => {
    console.error(`Simulator Connection Error: ${err.message}`);
    console.log("Make sure the server is running on port 8080 first!");
});

client.on('close', () => {
    console.log('Connection closed');
});
