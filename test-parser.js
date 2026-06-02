const parse = require('./parser');

const loginRaw = '$KA1234,868886061660604,010013,0100,28.601093,N,76.921288,E*10';
const trackRaw = '$Header,iTriangle1,010013,NR,1,L,868886061660604,KA1234,1,12042023,013615,28.675840,N,77.062378,E,21.0,212,20,206.0,1.26,0.68,Airtel,1,1,26.0,3.9,0,C,21,404,10,8ab,975e416,45,ab,de74335,38,8ab,e09c934,43,8ab,951a834,0,0,0,0000,0100,019053,0.000,0.000,18,()*78';

// Towing Started (Alert ID 52, ignition OFF, speed > 0)
const towingStartRaw = '$Header,iTriangle1,010013,NR,52,L,868886061660604,KA1234,1,12042023,013615,28.675840,N,77.062378,E,25.0,212,20,206.0,1.26,0.68,Airtel,0,1,26.0,3.9,0,C,21,404,10,8ab,975e416,45,ab,de74335,38,8ab,e09c934,43,8ab,951a834,0,0,0,0000,0100,019053,0.000,0.000,18,()*78';

// Harsh Braking (Alert ID 13, ignition ON, speed = 10)
const harshBrakingRaw = '$Header,iTriangle1,010013,HB,13,L,868886061660604,KA1234,1,12042023,013615,28.675840,N,77.062378,E,10.0,212,20,206.0,1.26,0.68,Airtel,1,1,26.0,3.9,0,C,21,404,10,8ab,975e416,45,ab,de74335,38,8ab,e09c934,43,8ab,951a834,0,0,0,0000,0100,019053,0.000,0.000,18,()*78';

console.log("=== Login Packet ===");
console.log(parse(Buffer.from(loginRaw)));

console.log("\n=== Normal Tracking Packet ===");
console.log(parse(Buffer.from(trackRaw)));

console.log("\n=== Towing Started Packet (ID 52) ===");
console.log(parse(Buffer.from(towingStartRaw)));

console.log("\n=== Harsh Braking Packet (ID 13) ===");
console.log(parse(Buffer.from(harshBrakingRaw)));
