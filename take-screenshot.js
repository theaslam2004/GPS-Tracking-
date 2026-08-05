const puppeteer = require('puppeteer-core');

(async () => {
    try {
        const browser = await puppeteer.launch({
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            headless: true,
            defaultViewport: { width: 1440, height: 900 }
        });
        const page = await browser.newPage();
        
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));

        // Login
        await page.goto('http://localhost:3000/login.html', { waitUntil: 'networkidle2' });
        await page.type('#username', 'simulator');
        await page.type('#password', 'simulator');
        await page.click('#loginBtn');
        
        // Wait for redirect
        await new Promise(r => setTimeout(r, 2000));
        
        // Go to customer portal
        await page.goto('http://localhost:3000/customer.html', { waitUntil: 'networkidle2' });
        
        // Wait for map and data to load
        await new Promise(r => setTimeout(r, 5000));
        
        // Attempt to click the first device in the list to open the side panel
        await page.evaluate(() => {
            const list = document.getElementById('deviceList');
            if (list && list.children.length > 0) {
                const firstDevice = list.children[0];
                if (firstDevice) {
                    firstDevice.click();
                }
            } else {
                console.log('No devices found in list');
            }
        });
        
        // Wait for panel to open and animations to finish
        await new Promise(r => setTimeout(r, 3000));
        
        await page.screenshot({ path: 'c:\\PROJECT\\public\\images\\mockup_1.png' });
        console.log('Screenshot 1 (Live) saved to mockup_1.png');
        
        // 2. Replay view
        await page.evaluate(() => {
            if (typeof switchMapTab === 'function') switchMapTab('replay');
        });
        await new Promise(r => setTimeout(r, 2000));
        await page.screenshot({ path: 'c:\\PROJECT\\public\\images\\mockup_2.png' });
        console.log('Screenshot 2 (Replay) saved to mockup_2.png');
        
        // 3. Settings view
        await page.evaluate(() => {
            if (typeof showSettingsModal === 'function') showSettingsModal();
        });
        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: 'c:\\PROJECT\\public\\images\\mockup_3.png' });
        console.log('Screenshot 3 (Settings) saved to mockup_3.png');
        
        await browser.close();
    } catch (err) {
        console.error(err);
    }
})();
