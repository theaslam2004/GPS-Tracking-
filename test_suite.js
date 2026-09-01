const assert = require('assert');
const parseDeviceData = require('./parser');
const store = require('./store');

async function runTests() {
    console.log('🧪 Starting Fleetly GPS Test Suite...\n');

    // Test 1: Parser - Normal Tracking Packet (8-digit date)
    {
        const raw8 = '$Header,iTriangle1,010013,NR,1,L,868886061660604,KA1234,1,12042023,013615,28.675840,N,77.062378,E,21.0,180.0,12,206.0,1.26,0.68,Airtel,1,1,12.0,4.2,0,C,31,404,10,8ab,975e416,45,ab,de74335,38,8ab,e09c934,43,8ab,951a834,0000,0001,008273,0.0,0.0,15.5*FF\r\n';
        const result = parseDeviceData(Buffer.from(raw8));
        assert.notStrictEqual(result, null);
        assert.strictEqual(result.imei, '868886061660604');
        assert.strictEqual(result.timestamp, '2023-04-12T01:36:15Z');
        assert.strictEqual(result.latitude, 28.67584);
        assert.strictEqual(result.longitude, 77.062378);
        assert.strictEqual(result.speed, 21);
        assert.strictEqual(result.ignition, true);
        assert.strictEqual(result.event, 'Location Update');
        console.log('✅ Test 1 Passed: Parser 8-digit date tracking packet');
    }

    // Test 2: Parser - Normal Tracking Packet (6-digit date)
    {
        const raw6 = '$Header,iTriangle1,010013,NR,1,L,868886061660604,KA1234,1,120423,013615,28.675840,N,77.062378,E,21.0,180.0,12,206.0,1.26,0.68,Airtel,1,1,12.0,4.2,0,C,31,404,10,8ab,975e416,45,ab,de74335,38,8ab,e09c934,43,8ab,951a834,0000,0001,008273,0.0,0.0,15.5*FF\r\n';
        const result = parseDeviceData(Buffer.from(raw6));
        assert.notStrictEqual(result, null);
        assert.strictEqual(result.timestamp, '2023-04-12T01:36:15Z');
        console.log('✅ Test 2 Passed: Parser 6-digit date tracking packet');
    }

    // Test 3: Parser - Towing Event Packet (Alert ID 52)
    {
        const rawTowing = '$Header,iTriangle1,010013,NR,52,L,868886061660604,KA1234,1,12042023,013615,28.675840,N,77.062378,E,25.0,212,20,206.0,1.26,0.68,Airtel,0,1,26.0,3.9,0,C,21,404,10,8ab,975e416,45,ab,de74335,38,8ab,e09c934,43,8ab,951a834,0,0,0,0000,0100,019053,0.000,0.000,18,()*78';
        const result = parseDeviceData(Buffer.from(rawTowing));
        assert.notStrictEqual(result, null);
        assert.strictEqual(result.packetType, 'TS');
        assert.strictEqual(result.event, 'Towing Started');
        console.log('✅ Test 3 Passed: Parser Towing Started event');
    }

    // Test 4: Parser - SIM / Malformed Packet Handling
    {
        const invalidRaw = '$Invalid,Data,123*00';
        const result = parseDeviceData(Buffer.from(invalidRaw));
        assert.strictEqual(result, null);
        console.log('✅ Test 4 Passed: Malformed packet safety returning null');
    }

    // Test 5: Store - Handling invalid dates in history queries gracefully
    {
        const history = await store.getHistory('868886061660604', 'invalid-start-date', 'invalid-end-date');
        assert(Array.isArray(history));
        console.log('✅ Test 5 Passed: Store getHistory invalid date handling');
    }

    // Test 6: Store - Handling invalid dates in day summary gracefully
    {
        const summary = await store.getDaySummary('868886061660604', 'invalid-start', 'invalid-end');
        assert.strictEqual(summary.distance, 0);
        assert.strictEqual(summary.alertCount, 0);
        console.log('✅ Test 6 Passed: Store getDaySummary invalid date handling');
    }

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});
