const fs = require('fs');

const dataFile = 'data.json';
const gujaratLat = 22.566216;
const gujaratLng = 71.80719;

try {
    const rawData = fs.readFileSync(dataFile, 'utf8');
    const db = JSON.parse(rawData);

    if (db.devices) {
        for (const imei in db.devices) {
            const device = db.devices[imei];
            if (device.latestData) {
                device.latestData.latitude = gujaratLat;
                device.latestData.longitude = gujaratLng;
                
                if (device.latestData.rawHex) {
                    // Update the rawHex string
                    const parts = device.latestData.rawHex.split(',');
                    // Parts indices for iTriangle (based on rawHex string):
                    // 11 is latitude, 13 is longitude
                    // "$Header,iTriangle1,010013,NR,1,L,352914091691580,KA01GPS,1,16062026,170423,22.566216,N,77.617391,E,..."
                    if (parts.length > 15) {
                        parts[11] = gujaratLat.toString();
                        parts[13] = gujaratLng.toString();
                        device.latestData.rawHex = parts.join(',');
                    }
                }
            }
        }
        
        fs.writeFileSync(dataFile, JSON.stringify(db, null, 4));
        console.log('Fixed data.json coordinates.');
    }
} catch (e) {
    console.error('Error fixing data.json:', e);
}
