const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = 'https://cmazun.github.io/Mazun-NFL-Survivor-League-/';
const local = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const expected = sha(local);
const report = { url, commit: process.env.GITHUB_SHA, expectedSha256: expected, deploymentMatched: false };
(async () => {
  fs.mkdirSync('screenshots', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ ...devices['iPhone 13'], browserName: undefined });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const deadline = Date.now() + 7 * 60 * 1000;
    let lastHash = '';
    while (Date.now() < deadline) {
      try {
        const response = await page.request.get(url + '?build=' + encodeURIComponent(process.env.GITHUB_SHA || expected) + '&t=' + Date.now(), {
          timeout: 15000, headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
        });
        if (response.ok()) {
          const published = await response.text();
          lastHash = sha(published);
          if (lastHash === expected) { report.deploymentMatched = true; break; }
        }
      } catch (e) { report.lastFetchError = String(e); }
      console.log('Waiting for GitHub Pages to publish matching index.html ...');
      await new Promise(resolve => setTimeout(resolve, 12000));
    }
    report.lastPublishedSha256 = lastHash;
    if (!report.deploymentMatched) throw Error('GitHub Pages did not publish matching HTML within 7 minutes');
    await page.goto(url + '?verified=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1200);
    const columns = await page.locator('.original-board thead th').count();
    const weeks = await page.locator('.original-board tbody tr').count();
    const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    report.columns = columns; report.weeks = weeks; report.widths = widths;
    const odds = await page.locator('.original-board thead .season-chance').allTextContents();
    report.leagueWinProbabilities = odds;
    if (odds.length !== 4 || odds.some(x => !/\\d+%\\s*LEAGUE WIN/.test(x))) errors.push('League-winning probability labels not rendered on live site');
    if (odds.length === 4 && Math.abs(odds.reduce((sum,x) => sum + Number(x.match(/(\\d+)%/)[1]), 0) - 100) > 2) errors.push('League probabilities do not sum to approximately 100%');
    const chanceVisible = await page.locator('.original-board thead .season-chance').first().isVisible();
    if (!chanceVisible) errors.push('League-winning probability labels hidden on live site');

    if (columns !== 5) errors.push('Expected 5 table headers, got ' + columns);
    if (weeks !== 18) errors.push('Expected 18 weeks, got ' + weeks);
    if (widths.document > widths.viewport + 3) errors.push('Horizontal overflow');
    await page.screenshot({ path: 'screenshots/iphone-live-website.png', fullPage: true });
    report.pageErrors = errors;
    if (errors.length) throw Error(errors.join('; '));
    console.log('Live site matches this commit and iPhone screenshot captured.');
  } catch (e) { report.error = String(e); console.error(e); process.exitCode = 1; }
  finally {
    fs.writeFileSync('screenshots/live-report.json', JSON.stringify(report, null, 2));
    await browser.close();
  }
})();
