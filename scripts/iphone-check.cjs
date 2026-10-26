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
  // Assert the visible feature, not merely that its source code exists.
  const odds = page.locator('.original-board thead .season-chance');
  if (await odds.count() !== 4) errors.push('Expected 4 visible league-win probability labels');
  const oddsText = await odds.allTextContents();
  if (oddsText.length !== 4 || oddsText.some(x => !/[0-9]+%[ ]*LEAGUE WIN/.test(x))) errors.push('Missing or malformed league-win labels: ' + JSON.stringify(oddsText));
  const percentages = oddsText.map(x => Number(x.match(/([0-9]+)%/)?.[1]));
  if (percentages.length === 4 && Math.abs(percentages.reduce((a,b) => a+b,0)-100)>2) errors.push('League win percentages do not total approximately 100%');
  if (await odds.count() === 4 && !await odds.first().isVisible()) errors.push('League win percentages are not visible');
  // Wins and losses in the header must have the same legible text color.
  const recordColors = await page.locator('.original-board .record-chip').first().evaluate(el => ({
    wins: getComputedStyle(el.querySelector('.wins')).color,
    losses: getComputedStyle(el.querySelector('.losses')).color
  }));
  if (recordColors.wins !== recordColors.losses) errors.push('Record win/loss colors differ: ' + JSON.stringify(recordColors));
  const originalOdds = oddsText.join('|');
  // A recorded result must change the calculated probabilities.
  await page.evaluate(() => { data.Ryan.push({week:8,team:'Buffalo Bills',result:'W',source:'manual',manualResult:true}); render(); });
  const changedOdds = (await page.locator('.original-board thead .season-chance').allTextContents()).join('|');
  if (changedOdds === originalOdds) errors.push('League probabilities did not update when results changed');
  await page.evaluate(() => { data.Ryan = data.Ryan.filter(x => x.week !== 8); render(); });
  await page.screenshot({ path: 'screenshots/iphone-overview.png', fullPage: true });
  const columns = await page.locator('.original-board thead th').count();
  if (columns !== 5) errors.push('Expected Week plus four player columns; got ' + columns);
  const picks = await page.locator('.original-board tbody tr').count();
  if (picks !== 18) errors.push('Expected 18 weekly rows; got ' + picks);
  const target = page.locator('.original-board td[data-player="Ryan"][data-week="8"]');
  await target.click();
  if (!await page.locator('#pickOverlay').isVisible()) errors.push('Quick pick dialog did not open');
  // Mock schedule response to verify matchup, kickoff and logo rendering deterministically.
  await page.route('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?*', async route => {
    const u = new URL(route.request().url());
    if (u.searchParams.get('week') !== '8') return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({events:[{date:'2026-11-01T18:00:00Z',competitions:[{competitors:[{homeAway:'home',team:{abbreviation:'BUF',displayName:'Buffalo Bills'}},{homeAway:'away',team:{abbreviation:'MIA',displayName:'Miami Dolphins'}}]}]}]}) });
  });
  await page.locator('#quickCancel').click();
  await page.evaluate(() => { delete scheduleCache[8]; });
  await target.click();
  await page.locator('.schedule-choice').first().waitFor({ timeout: 12000 });
  const choices = page.locator('.schedule-choice');
  if (await choices.count() < 20) errors.push('Expected available team selection cards');
  const bills = page.locator('.schedule-choice[data-team="Buffalo Bills"]');
  if (!await bills.count()) errors.push('Buffalo Bills selection card missing');
  else {
    const info = await bills.innerText();
    if (!info.includes('Miami Dolphins')) errors.push('Opponent missing from Bills matchup: ' + info);
    if (!info.includes('Nov 1')) errors.push('Kickoff date missing from Bills matchup: ' + info);
    if (!await bills.locator('img.logo').count()) errors.push('Team logo missing in selection card');
    await bills.click();
    if (await page.locator('#quickTeam').inputValue() !== 'Buffalo Bills') errors.push('Team card did not update selection');
  }
  if (await page.locator('#quickTeam option[value="Los Angeles Chargers"]').count()) errors.push('Previously used Ryan team is selectable');
  await page.screenshot({ path: 'screenshots/iphone-pick-dialog.png', fullPage: false });

  await page.locator('#quickCancel').click();
  const featureReport = { oddsText, changedOdds, recordColors, matchupCards: await choices.count(), selectedTeam: 'Buffalo Bills' };
  const widths = await page.evaluate(() => ({ viewport: innerWidth, doc: document.documentElement.scrollWidth }));
  if (widths.doc > widths.viewport + 3) errors.push('Horizontal overflow: ' + JSON.stringify(widths));
  fs.writeFileSync('screenshots/report.json', JSON.stringify({ date: new Date().toISOString(), columns, weeks: picks, widths, features: featureReport, errors }, null, 2));
  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('iPhone dashboard checks passed');
})().catch(e => { console.error(e); process.exit(1); });
