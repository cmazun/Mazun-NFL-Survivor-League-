const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  fs.mkdirSync('screenshots', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'], browserName: undefined });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Test the exact code in the commit, not a potentially stale Pages deployment.
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  await page.route('https://survivor.test/**', route => {
    if (route.request().url() === 'https://survivor.test/') {
      route.fulfill({ status: 200, contentType: 'text/html', body: html });
    } else route.continue();
  });
  await page.goto('https://survivor.test/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/iphone-overview.png', fullPage: true });
  const columns = await page.locator('.original-board thead th').count();
  if (columns !== 5) errors.push('Expected Week plus four player columns; got ' + columns);
  const picks = await page.locator('.original-board tbody tr').count();
  if (picks !== 18) errors.push('Expected 18 weekly rows; got ' + picks);
  const target = page.locator('.original-board td[data-player="Ryan"][data-week="8"]');
  await target.click();
  if (!await page.locator('#pickOverlay').isVisible()) errors.push('Quick pick dialog did not open');
  await page.screenshot({ path: 'screenshots/iphone-pick-dialog.png', fullPage: false });
  await page.locator('#quickCancel').click();
  const widths = await page.evaluate(() => ({ viewport: innerWidth, doc: document.documentElement.scrollWidth }));
  if (widths.doc > widths.viewport + 3) errors.push('Horizontal overflow: ' + JSON.stringify(widths));
  fs.writeFileSync('screenshots/report.json', JSON.stringify({ date: new Date().toISOString(), columns, weeks: picks, widths, errors }, null, 2));
  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('iPhone dashboard checks passed');
})().catch(e => { console.error(e); process.exit(1); });
