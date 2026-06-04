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

  // Handle confirm/alert dialogs automatically
  page.on('dialog', async dialog => {
    console.log(`[DIALOG] Dialog opened: "${dialog.message()}" [type: ${dialog.type()}]. Accepting...`);
    await dialog.accept();
  });

  // Step 1: Admin Login
  console.log('Step 1: Navigating to login page...');
  await page.goto('http://localhost:3000/index.html');

  console.log('Logging in as Admin...');
  await page.fill('#username', 'admin');
  await page.fill('#password', 'password');
  await page.click('#loginBtn');

  console.log('Waiting for redirect to admin dashboard...');
  await page.waitForURL('**/admin.html', { timeout: 10000 });
  console.log('Admin logged in successfully.');

  await page.waitForTimeout(3000);

  // Step 2: Create a Customer
  console.log('Step 2: Creating a new customer...');
  await page.click('button:has-text("New User")');
  await page.waitForSelector('#addCustomerModal.active', { timeout: 5000 });

  const randomSuffix = Math.floor(Math.random() * 10000);
  const testUsername = `customer_${randomSuffix}`;
  console.log(`Adding customer with username: ${testUsername}`);

  await page.fill('#newUsername', testUsername);
  await page.fill('#newPassword', 'password123');
  await page.fill('#newPhone', '9876543210');
  await page.fill('#newEmail', `${testUsername}@example.com`);

  // Intercept the create-customer response
  const createPromise = page.waitForResponse(response => 
    response.url().includes('/api/admin/create-customer') && response.status() === 200
  );
  
  await page.click('button:has-text("Create Account")');
  
  const createResponse = await createPromise;
  const createResult = await createResponse.json();
  console.log('Customer creation API result:', createResult);

  if (!createResult.success) {
    throw new Error('Failed to create customer: ' + createResult.error);
  }
  console.log('Customer created successfully.');

  await page.waitForTimeout(3000);

  // Logout from Admin
  console.log('Logging out from admin...');
  await page.click('.btn-logout');
  await page.waitForURL('**/index.html', { timeout: 5000 });

  // Step 3: Login as the new customer
  console.log('Step 3: Logging in as the new customer...');
  await page.fill('#username', testUsername);
  await page.fill('#password', 'password123');
  await page.click('#loginBtn');

  await page.waitForURL('**/customer.html', { timeout: 10000 });
  console.log('Customer logged in successfully.');

  await page.waitForTimeout(4000);

  // Take screenshot of the customer dashboard showing Trial plan
  const customerScreenshotPathBefore = 'C:/Users/aslam/.gemini/antigravity/brain/68839d32-018b-47d5-bebb-6ca1e0830db0/customer_before_upgrade.png';
  await page.screenshot({ path: customerScreenshotPathBefore, fullPage: true });
  console.log('Customer before upgrade screenshot saved.');

  // Step 4: Upgrade plan
  console.log('Step 4: Upgrading plan...');
  await page.click('#subBanner');
  await page.waitForSelector('#upgradeModal.active', { timeout: 5000 });

  console.log('Upgrading to Basic Plan...');
  const basicUpgradeBtn = page.locator('.plan-card:has-text("Basic") button');
  await basicUpgradeBtn.scrollIntoViewIfNeeded();
  
  const upgradePromise = page.waitForResponse(response => 
    response.url().includes('/api/customer/upgrade-plan') && response.status() === 200
  );
  await basicUpgradeBtn.click();
  
  const upgradeResponse = await upgradePromise;
  const upgradeResult = await upgradeResponse.json();
  console.log('Plan upgrade API result:', upgradeResult);

  await page.waitForTimeout(4000);

  // Take screenshot of customer dashboard showing Basic plan
  const customerScreenshotPathAfter = 'C:/Users/aslam/.gemini/antigravity/brain/68839d32-018b-47d5-bebb-6ca1e0830db0/customer_after_upgrade.png';
  await page.screenshot({ path: customerScreenshotPathAfter, fullPage: true });
  console.log('Customer after upgrade screenshot saved.');

  // Logout from Customer
  console.log('Logging out from customer...');
  await page.click('.sidebar-header button.btn-outline');
  await page.waitForURL('**/index.html', { timeout: 5000 });

  // Step 5: Admin Login and Verify Metrics
  console.log('Step 5: Logging back into Admin to verify metrics...');
  await page.fill('#username', 'admin');
  await page.fill('#password', 'password');
  await page.click('#loginBtn');

  await page.waitForURL('**/admin.html', { timeout: 10000 });
  console.log('Admin logged in again.');

  await page.waitForTimeout(4000);

  // Take screenshot of the admin dashboard showing new revenue and logs
  const adminScreenshotPath = 'C:/Users/aslam/.gemini/antigravity/brain/68839d32-018b-47d5-bebb-6ca1e0830db0/admin_revenue_dashboard.png';
  await page.screenshot({ path: adminScreenshotPath, fullPage: true });
  console.log('Admin final dashboard screenshot saved to:', adminScreenshotPath);

  await browser.close();
  console.log('Workflow Integration Test completed successfully!');
})();
