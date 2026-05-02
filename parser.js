/**
 * Real Parser for Bharat 101 (iTriangle / TS101 Plus) Protocol
 * 
 * Based on the official TS101 Plus 4G Protocol Manual
 * Example packet: $Header,iTriangle1,010013,NR,1,L,868886061660604,KA1234,1,12042023,013615,28.675840,N,77.062378,E,21.0,...
 */

function parseDeviceData(buffer) {
    const rawString = buffer.toString('ascii').trim();
    
    // Log the EXACT raw data so you can see it in your terminal
    console.log("\n--- INCOMING RAW DEVICE DATA ---");
    console.log(rawString);
    console.log("--------------------------------\n");

    try {
        // If it's from our local simulator script
        if (rawString.startsWith("SIM,")) {
            const parts = rawString.split(',');
            return {
                imei: parts[1],
                timestamp: new Date().toISOString(),
                latitude: parseFloat(parts[2]),
                longitude: parseFloat(parts[3]),
                speed: parseFloat(parts[4]),
                heading: Math.floor(Math.random() * 360),
                satellites: Math.floor(Math.random() * 5) + 8, // Mock 8-12 satellites
                gpsValid: true,
                battery: Math.floor(Math.random() * 20) + 80, // Mock 80-100%
                rawHex: rawString // Passing ASCII string to the UI instead of Hex
            };
        }

        // If it's a real device tracking packet (StartsWith $Header or $)
        if (rawString.startsWith("$")) {
            const parts = rawString.split(',');

                // We must have enough parts to extract Location and IMEI
            if (parts.length >= 18) {
                
                const vendorId = parts[1];
                const packetType = parts[3]; // NR (Normal), EA (Emergency), etc.
                const imei = parts[6]; // 15-digit IMEI
                
                // Since the number of fields before the date can vary (e.g. empty fields),
                // we find the Latitude Direction ('N' or 'S') and use it as an anchor.
                const latDirIndex = parts.findIndex(p => p === 'N' || p === 'S');
                
                if (latDirIndex > 2) {
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

                    // Coordinates and Speed
                    let latitude = parseFloat(parts[latDirIndex - 1]);
                    const latDir = parts[latDirIndex]; // N or S
                    if (latDir === 'S') latitude = -latitude;

                    let longitude = parseFloat(parts[latDirIndex + 1]);
                    const lonDir = parts[latDirIndex + 2]; // E or W
                    if (lonDir === 'W') longitude = -longitude;

                    const speed = parseFloat(parts[latDirIndex + 3]);
                    const heading = parseFloat(parts[latDirIndex + 4]);
                    
                    // Advanced Metrics
                    const gpsFix = parts[latDirIndex - 4];
                    const isGpsValid = (gpsFix === '1' || gpsFix === 'A');
                    const satellites = parseFloat(parts[latDirIndex + 6]);
                    
                    let batteryVoltage = 4.2; // default
                    if (parts.length > latDirIndex + 13) {
                        const parsedVolt = parseFloat(parts[latDirIndex + 13]);
                        if(!isNaN(parsedVolt)) batteryVoltage = parsedVolt;
                    }
                    
                    // Convert internal battery voltage to percentage (approx 3.4V to 4.2V scale)
                    let batteryPercentage = Math.round(((batteryVoltage - 3.4) / (4.2 - 3.4)) * 100);
                    if (batteryPercentage > 100) batteryPercentage = 100;
                    if (batteryPercentage < 0) batteryPercentage = 0;
                    
                    // Attempt to grab odometer from end of string (typically parts[length - 2] in AIS140)
                    let odometer = 0;
                    if (parts.length > 5) {
                        // The last part is usually ()*checksum or 0*checksum
                        // The second to last part is usually the odometer float
                        const potentialOdoStr = parts[parts.length - 2];
                        const potentialOdo = parseFloat(potentialOdoStr);
                        if (!isNaN(potentialOdo) && potentialOdoStr.includes('.')) {
                            odometer = potentialOdo; // Format 1: x.xxx
                        } else {
                            // Try formatting from earlier versions or fallback
                            const altOdo = parseFloat(parts[parts.length - 6]);
                            if (!isNaN(altOdo)) odometer = altOdo;
                        }
                    }

                    return {
                        imei: imei,
                        timestamp: timestamp,
                        latitude: latitude,
                        longitude: longitude,
                        speed: speed,
                        heading: heading,
                        odometer: odometer,
                        satellites: satellites || 0,
                        gpsValid: isGpsValid,
                        battery: batteryPercentage,
                        rawHex: rawString, // Send the exact ASCII string to the web interface log!
                        packetType: packetType
                    };
                }
            }
        }
        
        // If the packet didn't match the standard tracking structure, just log it.
        return null;
        
    } catch (error) {
        console.error("Error parsing the GPS data:", error);
        return null; // Return null so the server sends it to the "raw logs" web box
    }
}

module.exports = parseDeviceData;
