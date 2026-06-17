/**
 * Real Parser for Bharat 101 (iTriangle / TS101 Plus) Protocol
 * 
 * Based on the official TS101 Plus 4G Protocol Manual
 * Example packet: $Header,iTriangle1,010013,NR,1,L,868886061660604,KA1234,1,12042023,013615,28.675840,N,77.062378,E,21.0,...
 */

function parseDeviceData(buffer) {
    const rawString = buffer.toString('ascii').trim();
    
    console.log("\n--- INCOMING RAW DEVICE DATA ---");
    console.log(rawString);
    console.log("--------------------------------\n");

    try {
        if (rawString.startsWith("SIM,")) {
            const parts = rawString.split(',');
            return {
                imei: parts[1],
                timestamp: new Date().toISOString(),
                latitude: parseFloat(parts[2]),
                longitude: parseFloat(parts[3]),
                speed: parseFloat(parts[4]),
                heading: Math.floor(Math.random() * 360),
                satellites: Math.floor(Math.random() * 5) + 8,
                gpsValid: true,
                battery: Math.floor(Math.random() * 20) + 80,
                rawHex: rawString
            };
        }

        if (rawString.startsWith("$")) {
            // Remove the *checksum at the end
            const mainContent = rawString.split('*')[0];
            const parts = mainContent.split(',');

            // Login Packet: e.g., $KA1234,868886061660604,010013,0100,28.601093,N,76.921288,E*10
            if (parts.length >= 8 && parts[1] && parts[1].length >= 14 && /^\d+$/.test(parts[1]) && parts[4] && parts[5] && (parts[5] === 'N' || parts[5] === 'S')) {
                // If it looks like a Login Packet (short packet with IMEI as second element)
                const packetTypeStr = parts[3];
                // Check if it's purely numerical packet type (like 0100) or we just assume by length
                if (parts.length < 15) {
                    const imei = parts[1];
                    let latitude = parseFloat(parts[4]);
                    if (parts[5] === 'S') latitude = -latitude;
                    let longitude = parseFloat(parts[6]);
                    if (parts[7] === 'W') longitude = -longitude;

                    return {
                        imei: imei,
                        timestamp: new Date().toISOString(),
                        latitude: latitude || 0,
                        longitude: longitude || 0,
                        speed: 0,
                        heading: 0,
                        satellites: 0,
                        gpsValid: true,
                        battery: 100,
                        packetType: 'Login',
                        rawHex: rawString
                    };
                }
            }

            // Tracking Packet: $Header,iTriangle1,...
            const latDirIndex = parts.findIndex(p => p === 'N' || p === 'S');
            
            if (latDirIndex > 2) {
                // Look for 15-digit IMEI before the coordinates
                let imei = "";
                let imeiIndex = -1;
                for (let i = 0; i < latDirIndex; i++) {
                    if (parts[i] && parts[i].length >= 14 && /^\d+$/.test(parts[i])) {
                        imei = parts[i];
                        imeiIndex = i;
                        break;
                    }
                }
                
                // Prevent conflict: A simulator in Bangalore is using the exact same IMEI as the user's device in Gujarat
                if (imei === '866359076347189' && parts.includes('KA01GPS')) {
                    imei = '866359076347189_SIM';
                }
                
                let gpsValid = true;
                if (imeiIndex > 0) {
                    // Check the field immediately before IMEI for 'V' (Void)
                    if (parts[imeiIndex - 1] === 'V') {
                        gpsValid = false;
                    }
                }
                
                const packetType = parts[3]; // e.g., NR
                
                const dateStr = parts[latDirIndex - 3];
                const timeStr = parts[latDirIndex - 2];
                
                let timestamp = new Date().toISOString();
                if (dateStr && dateStr.length === 8 && timeStr && timeStr.length >= 6) {
                    const day = dateStr.substring(0, 2);
                    const month = dateStr.substring(2, 4);
                    const year = dateStr.substring(4, 8);
                    
                    const hours = timeStr.substring(0, 2);
                    const mins = timeStr.substring(2, 4);
                    const secs = timeStr.substring(4, 6);
                    
                    timestamp = `${year}-${month}-${day}T${hours}:${mins}:${secs}Z`;
                }

                let latitude = parseFloat(parts[latDirIndex - 1]);
                if (parts[latDirIndex] === 'S') latitude = -latitude;

                let longitude = parseFloat(parts[latDirIndex + 1]);
                if (parts[latDirIndex + 2] === 'W') longitude = -longitude;

                const speed = parseFloat(parts[latDirIndex + 3]) || 0;
                const heading = parseFloat(parts[latDirIndex + 4]) || 0;
                const satellites = parseFloat(parts[latDirIndex + 5]) || 0;
                
                let ignition = false;
                if (parts.length > latDirIndex + 10 && parts[latDirIndex + 10] === '1') {
                    ignition = true;
                }
                
                let mainPower = true;
                if (parts.length > latDirIndex + 11 && parts[latDirIndex + 11] === '0') {
                    mainPower = false;
                }

                let voltage = 12.0;
                if (parts.length > latDirIndex + 12) {
                    const v = parseFloat(parts[latDirIndex + 12]);
                    if (!isNaN(v)) voltage = v;
                }

                let batteryPercentage = 100;
                if (parts.length > latDirIndex + 13) {
                    const intVolt = parseFloat(parts[latDirIndex + 13]);
                    if (!isNaN(intVolt) && intVolt > 0) {
                        batteryPercentage = Math.round(((intVolt - 3.4) / (4.2 - 3.4)) * 100);
                        if (batteryPercentage > 100) batteryPercentage = 100;
                        if (batteryPercentage < 0) batteryPercentage = 0;
                    }
                }
                
                let deltaDistance = 0;
                if (parts.length > latDirIndex + 5) {
                    const lastPart = parts[parts.length - 1];
                    if (lastPart === '()' || lastPart === '') {
                        deltaDistance = parseFloat(parts[parts.length - 2]) || 0;
                    } else {
                        deltaDistance = parseFloat(lastPart) || 0;
                    }
                }

                const alertId = parseInt(parts[4]);
                let event = null;
                let parsedPacketType = packetType;

                // Map by Alert ID first
                switch (alertId) {
                    case 1: event = 'Location Update'; break;
                    case 3: event = 'Vehicle Battery Disconnected'; parsedPacketType = 'BD'; mainPower = false; break;
                    case 4: event = 'Internal Battery Low'; parsedPacketType = 'BL'; break;
                    case 6: event = 'Vehicle Battery Reconnected'; parsedPacketType = 'BR'; mainPower = true; break;
                    case 7: event = 'Ignition ON'; parsedPacketType = 'IN'; ignition = true; break;
                    case 8: event = 'Ignition OFF'; parsedPacketType = 'IF'; ignition = false; break;
                    case 9: event = 'GPS box opened'; parsedPacketType = 'TA'; break;
                    case 10: event = 'Emergency Alert (SOS)'; parsedPacketType = 'EA'; break;
                    case 11: event = 'Emergency Alert (SOS) Cleared'; break;
                    case 13: event = 'Harsh Braking'; parsedPacketType = 'HB'; break;
                    case 14: event = 'Harsh Acceleration'; parsedPacketType = 'HA'; break;
                    case 15: event = 'Rash Turning'; parsedPacketType = 'RT'; break;
                    case 16: event = 'Emergency button Tampered'; parsedPacketType = 'TA'; break;
                    case 51: event = 'Tilt Alert'; break;
                    case 52: event = 'Towing Started'; parsedPacketType = 'TS'; break;
                    case 53: event = 'Towing Stopped'; parsedPacketType = 'TE'; break;
                }

                // Fallback to packet type if no event was mapped by alert ID
                if (!event) {
                    switch (packetType) {
                        case 'EA': event = 'Emergency Alert (SOS)'; break;
                        case 'TA': event = 'Tamper Alert'; break;
                        case 'HP': event = 'Health Packet'; break;
                        case 'IN': event = 'Ignition ON'; ignition = true; break;
                        case 'IF': event = 'Ignition OFF'; ignition = false; break;
                        case 'BD': event = 'Vehicle Battery Disconnected'; mainPower = false; break;
                        case 'BR': event = 'Vehicle Battery Reconnected'; mainPower = true; break;
                        case 'BL': event = 'Internal Battery Low'; break;
                        case 'HB': event = 'Harsh Braking'; break;
                        case 'HA': event = 'Harsh Acceleration'; break;
                        case 'RT': event = 'Rash Turning'; break;
                        case 'TS': event = 'Towing Started'; break;
                        case 'TE': event = 'Towing Stopped'; break;
                        case 'DT': event = 'Emergency Tamper'; break;
                        case 'OA': event = 'Over the Air Command'; break;
                    }
                }

                return {
                    imei: imei || (parts.length > 6 ? parts[6] : "UNKNOWN"),
                    timestamp: timestamp,
                    latitude: latitude || 0,
                    longitude: longitude || 0,
                    speed: speed,
                    heading: heading,
                    satellites: satellites,
                    gpsValid: gpsValid,
                    battery: batteryPercentage,
                    deltaDistance: deltaDistance,
                    ignition: ignition,
                    mainPower: mainPower,
                    voltage: voltage,
                    packetType: parsedPacketType,
                    event: event,
                    rawHex: rawString
                };
            }
        }
        
        return null;
    } catch (error) {
        console.error("Error parsing the GPS data:", error);
        return null;
    }
}

module.exports = parseDeviceData;
