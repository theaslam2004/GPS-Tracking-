const net = require('net');
const fs = require('fs');
const path = require('path');

const TCP_PORT = 8080;
const HOST = '127.0.0.1';

const client = new net.Socket();

function getChecksum(payload) {
    let checksum = 0;
    for (let i = 0; i < payload.length; i++) {
        checksum ^= payload.charCodeAt(i);
    }
    return checksum.toString(16).toUpperCase().padStart(2, '0');
}

function pad(n) {
    return n < 10 ? '0' + n : n;
}

function formatDate() {
    const d = new Date();
    return `${pad(d.getUTCDate())}${pad(d.getUTCMonth() + 1)}${d.getUTCFullYear()}`;
}

function formatTime() {
    const d = new Date();
    return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

client.connect(TCP_PORT, HOST, () => {
    console.log(`Connected to tracker server at ${HOST}:${TCP_PORT}`);
    
    // Login Packets
    const login1 = `KA1234,866359076347189,010013,0100,28.6139,N,77.2090,E`;
    client.write(Buffer.from(`$${login1}*${getChecksum(login1)}\n`));
    
    const login2 = `MH12AB1234,987654321098765,010013,0100,19.0760,N,72.8777,E`;
    client.write(Buffer.from(`$${login2}*${getChecksum(login2)}\n`));

    // Vehicle 3: KA5555 (Will stay offline/silent)
    const login3 = `KA5555,866359076347111,010013,0100,12.9716,N,77.5946,E`;
    client.write(Buffer.from(`$${login3}*${getChecksum(login3)}\n`));
    
    let lat1 = 28.6139;
    let lng1 = 77.2090;
    let odo1 = 1205.5;
    
    let lat2 = 19.0760;
    let lng2 = 72.8777;
    let odo2 = 45000.2;

    setInterval(() => {
        const dateStr = formatDate();
        const timeStr = formatTime();

        // CHECK FOR PANIC TRIGGER
        let isPanic = false;
        if (require('fs').existsSync('panic.trigger')) {
            isPanic = true;
            console.log("!!! PANIC TRIGGER DETECTED !!!");
            try { require('fs').unlinkSync('panic.trigger'); } catch(e){}
        }

        // Device 1 (ACTIVE)
        lat1 += (Math.random() - 0.5) * 0.001;
        lng1 += (Math.random() - 0.5) * 0.001;
        const speed1 = Math.floor(Math.random() * 50) + 30; // Constant speed for "Active"
        odo1 += (speed1 / 3600) * 3;
        
        let packetType1 = isPanic ? 'EA' : 'NR';
        const payload1 = `Header,iTriangle1,010013,${packetType1},1,L,866359076347189,KA1234,1,${dateStr},${timeStr},${lat1.toFixed(6)},N,${lng1.toFixed(6)},E,${speed1.toFixed(1)},212,20,206.0,1.26,0.68,Airtel,1,1,26.0,3.9,0,C,21,404,10,8ab,975e416,45,ab,de74335,38,8ab,e09c934,43,8ab,951a834,0,0,0,0000,0100,019053,0.000,0.000,${odo1.toFixed(3)},()`;
        const packet1 = `$${payload1}*${getChecksum(payload1)}`;
        client.write(Buffer.from(packet1 + '\n'));
        
        // Device 2 (IDLE)
        const speed2 = 0; // Speed 0 = Idle
        const payload2 = `Header,iTriangle1,010013,NR,2,L,987654321098765,MH12AB1234,1,${dateStr},${timeStr},${lat2.toFixed(6)},N,${lng2.toFixed(6)},E,${speed2.toFixed(1)},90,18,15.0,1.10,0.80,Jio,1,1,25.5,4.1,0,C,25,405,860,11a,1234567,40,ab,1234568,35,11a,1234569,38,11a,1234560,0,0,0,0000,0100,020055,0.000,0.000,${odo2.toFixed(3)},()`;
        const packet2 = `$${payload2}*${getChecksum(payload2)}`;
        client.write(Buffer.from(packet2 + '\n'));
        
        console.log(`[SIM] Sent: Active (KA1234), Idle (MH12AB1234). Stale/Offline: KA5555`);
    }, 3000);
});

client.on('error', (err) => {
    console.error(`Simulator Connection Error: ${err.message}`);
    console.log("Make sure the server is running on port 8080 first!");
});

client.on('close', () => {
    console.log('Connection closed');
});
