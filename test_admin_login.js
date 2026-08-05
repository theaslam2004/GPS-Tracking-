const { chromium } = require('C:/Users/aslam/AppData/Local/ms-playwright-go/1.57.0/package');
const path = require('path');

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => {
    console.log(`[BROWSER CONSOLE] ${msg.type().toUpperCase()}: ${msg.text()}`);
  });

  page.on('pageerror', err => {
    console.log(`[BROWSER ERROR] ${err.message}\nStack: ${err.stack}`);
  });

  console.log('Navigating to login page...');
  await page.goto('http://localhost:3000/login.html');

  console.log('Logging in as Admin...');
  await page.fill('#username', 'admin');
  await page.fill('#password', 'password');
  await page.click('#loginBtn');

  console.log('Waiting for redirect to admin dashboard...');
  await page.waitForURL('**/admin.html', { timeout: 10000 });
  console.log('Redirected to admin.html successfully.');

  // Wait for the UI elements to load
  await page.waitForTimeout(3000);

  // Take screenshot of the admin dashboard
  const screenshotPath = 'C:/Users/aslam/.gemini/antigravity/brain/68839d32-018b-47d5-bebb-6ca1e0830db0/admin_dashboard.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Screenshot saved to:', screenshotPath);

  await browser.close();
})();
