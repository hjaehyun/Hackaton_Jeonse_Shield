import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const results = [];
const externalRequests = [];
const errors = [];
const baseURL = process.argv[2] || 'http://localhost:3000';

async function fit(page, label) {
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(widths.document <= widths.viewport && widths.body <= widths.viewport, `${label}: ${JSON.stringify(widths)}`);
  assert.equal(await page.locator('#site-footer').evaluate((el) => getComputedStyle(el).position), 'fixed');
  results.push({ check: label, result: 'pass', ...widths });
}
async function capture(page, name) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: `artifacts/${name}.png` });
  await page.screenshot({ path: `artifacts/${name}-full.png`, fullPage: true });
}
async function clickNext(page) { await page.locator('#next-step').click(); }

// Step 2 is now a list built from real transactions, so it has to load before
// anything can be picked. These tests run against the live ministry API; the
// Worker caches each region-month in local D1, so repeat runs do not re-fetch.
async function pickComplex(page, index = 0) {
  await page.locator('#complex-list .complex-option').first().waitFor({ state: 'visible', timeout: 30000 });
  const option = page.locator('#complex-list .complex-option').nth(index);
  const name = (await option.locator('strong').innerText()).trim();
  await option.click();
  return name;
}

async function fillToReport(page, area, deposit = '35000', rent = '0') {
  await page.goto(baseURL + '/#diagnosis');
  await page.locator('#sido-select option[value="서울특별시"]').waitFor({ state: 'attached' });
  await page.selectOption('#sido-select', '서울특별시');
  await page.selectOption('#district-select', '11110');
  await clickNext(page);
  await pickComplex(page);
  await clickNext(page);
  await page.fill('#area-input', area);
  await page.fill('#deposit-input', deposit);
  await page.fill('#rent-input', rent);
  await clickNext(page);
  await page.locator('#result-screen').waitFor({ state: 'visible' });
}

try {
  for (const width of [360, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (request) => { if (!request.url().startsWith(baseURL)) externalRequests.push(request.url()); });
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await fit(page, `${width}px landing`);
    if ([360, 1440].includes(width)) await capture(page, `landing-${width}`);
    await page.locator('.hero-cta').click();
    await clickNext(page);
    assert.match(await page.locator('#form-error').innerText(), /시도를 선택/);
    await page.selectOption('#sido-select', '서울특별시');
    await clickNext(page);
    assert.match(await page.locator('#form-error').innerText(), /시군구를 선택/);
    await page.selectOption('#district-select', '11110');
    await fit(page, `${width}px wizard step 1`);
    await clickNext(page);
    await clickNext(page);
    assert.match(await page.locator('#form-error').innerText(), /단지를 선택/);
    const chosen = await pickComplex(page);
    assert.ok(chosen.length > 0, 'the list must show a real complex name');
    results.push({ check: `${width}px complex list built from live transactions`, result: 'pass', chosen });

    // The label the list prints must find that entry when typed back. Names
    // carry parentheses the matching key strips, so searching on the key alone
    // makes a complex unsearchable by its own displayed name.
    const options = () => page.locator('#complex-list .complex-option');
    await page.fill('#complex-filter', chosen);
    assert.ok(await options().count() >= 1, `typing the displayed name "${chosen}" found nothing`);
    await page.fill('#complex-filter', '없을만한이름zzz');
    assert.equal(await options().count(), 0);
    assert.equal(await page.locator('#complex-empty').isVisible(), true);
    await page.fill('#complex-filter', '');
    results.push({ check: `${width}px a complex is findable by its displayed name`, result: 'pass' });
    await pickComplex(page);
    await page.locator('#previous-step').click();
    assert.equal(await page.locator('#district-select').inputValue(), '11110');
    await clickNext(page);
    assert.equal(await page.locator('#complex-option-selected, .complex-option.selected').count(), 1, 'the selection must survive going back');
    await fit(page, `${width}px wizard step 2`);
    await clickNext(page);
    await clickNext(page);
    assert.match(await page.locator('#form-error').innerText(), /전용면적/);
    await page.fill('#area-input', '84');
    await page.fill('#deposit-input', '-1');
    await clickNext(page);
    assert.match(await page.locator('#form-error').innerText(), /보증금/);
    await page.fill('#deposit-input', '35000');
    await page.fill('#rent-input', '-1');
    await clickNext(page);
    assert.match(await page.locator('#form-error').innerText(), /월세/);
    await page.fill('#rent-input', '0');
    await fit(page, `${width}px wizard step 3`);
    if ([360, 1440].includes(width)) await capture(page, `wizard-${width}`);
    await clickNext(page);
    await page.locator('#result-screen').waitFor({ state: 'visible' });
    assert.match(await page.locator('.ratio-value').innerText(), /58\.3/);
    assert.equal(await page.locator('#ratio-card').getAttribute('data-verdict'), 'safe');
    assert.equal(await page.locator('#sample-count').innerText(), '표본 12건');
    // The last gauge tick sits at left:100%, where the available width is 0.
    // Without white-space:nowrap it shrink-wraps to one character per line.
    const tickBoxes = await page.locator('.gauge-ticks > span').evaluateAll(
      (els) => els.map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent.trim(), width: r.width, height: r.height };
      }),
    );
    const tallestTick = Math.max(...tickBoxes.map((t) => t.height));
    assert.ok(tallestTick < 24, `gauge tick wrapped: ${JSON.stringify(tickBoxes)}`);
    results.push({ check: `${width}px gauge ticks stay on one line`, result: 'pass', tallestTick });

    // Every number printed on the chart must be an observed value. Padded axis
    // bounds look like data and contradict the statistics table below them.
    const chartNumbers = await page.locator('.box-plot text').evaluateAll(
      (els) => els.map((el) => el.textContent.trim()).filter((t) => /\d/.test(t)),
    );
    const tableNumbers = await page.locator('.distribution-stats dd').evaluateAll(
      (els) => els.map((el) => el.textContent.trim()),
    );
    const depositLabel = await page.locator('#deposit-input').inputValue();
    const allowed = new Set([...tableNumbers, new Intl.NumberFormat('ko-KR').format(Number(depositLabel))]);
    const invented = chartNumbers.filter((n) => ![...allowed].some((a) => n.includes(a)));
    assert.deepEqual(invented, [], `chart shows numbers absent from the statistics table: ${JSON.stringify({ chartNumbers, tableNumbers })}`);
    results.push({ check: `${width}px chart prints only observed values`, result: 'pass', chartNumbers });

    // The fixed footer carries the standing legal notice. Repeating it in the
    // report body costs a screenful on mobile and tells the reader nothing new.
    const noticeCount = await page.evaluate(
      () => document.body.innerText.split('참고용 정보이며 법률 자문이 아닙니다').length - 1,
    );
    assert.equal(noticeCount, 1, 'the legal notice appears more than once on the result screen');
    results.push({ check: `${width}px legal notice appears once`, result: 'pass' });
    await fit(page, `${width}px result 12 samples`);
    if ([360, 1440].includes(width)) await capture(page, `result-${width}`);
    await page.locator('.check-item input').first().check();
    assert.equal(await page.locator('#checklist-count').innerText(), '1 / 5 확인');
    await page.locator('#edit-input').click();
    await page.fill('#area-input', '59');
    await clickNext(page);
    await page.locator('#result-screen').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#sample-count').innerText(), '표본 2건');
    assert.equal(await page.locator('.ratio-value').count(), 0);
    assert.equal(await page.locator('.ratio-gauge').count(), 0);
    assert.equal(await page.locator('.box-plot').count(), 0);
    assert.equal(await page.locator('.distribution-stats').count(), 0);
    assert.equal(await page.locator('#checklist-count').innerText(), '0 / 5 확인');
    assert.match(await page.locator('#ratio-content').innerText(), /표본 부족 — 판정 불가/);
    await fit(page, `${width}px result 2 samples, no numeric statistics`);
    if (width === 360) await capture(page, 'result-insufficient-360');
    await page.locator('#edit-input').click();
    await page.fill('#area-input', '120');
    await clickNext(page);
    await page.locator('#result-screen').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#sample-count').innerText(), '표본 0건');
    assert.equal(await page.locator('.ratio-value').count(), 0);
    await fit(page, `${width}px result 0 samples`);
    await page.locator('#edit-input').click();
    await page.fill('#area-input', '84');
    await page.fill('#deposit-input', '80000');
    await page.fill('#rent-input', '50');
    await clickNext(page);
    await page.locator('#result-screen').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#ratio-card').getAttribute('data-verdict'), 'danger');
    assert.match(await page.locator('.ratio-value').innerText(), /133\.3/);
    assert.equal(await page.locator('#monthly-rent-note').isVisible(), true);
    await fit(page, `${width}px ratio over 100 and monthly rent`);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('#home-screen').isVisible(), true);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await context.close();
  }
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  page.on('pageerror', (e) => errors.push(e.message));
  // Complex names come from the ministry now, not from the user, so that is
  // where untrusted text enters the page. Serve a hostile one and check it is
  // rendered as text in both the list and the report.
  const HOSTILE = '<img src=x onerror=alert(1)>';
  await page.route('**/api/month*', async (route) => {
    const kind = new URL(route.request().url()).searchParams.get('kind');
    const shared = { name: HOSTILE, key: 'hostile', area: 84, floor: 3, year: 2026, month: 6, day: 17 };
    const rows = kind === 'trade'
      ? [1, 2, 3, 4].map((n) => ({ ...shared, price: 60000 + n * 1000, cancelled: false }))
      : [{ ...shared, deposit: 35000, monthlyRent: 0 }];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ kind, rows }) });
  });
  await fillToReport(page, '84', '35000', '0');
  assert.equal(await page.locator('#complex-list img').count(), 0, 'the list rendered supplied markup');
  assert.match(await page.locator('#contract-summary').innerText(), /<img src=x/);
  assert.equal(await page.locator('#contract-summary img').count(), 0);
  results.push({ check: 'ministry-supplied names escaped; no HTML execution', result: 'pass' });
  await page.unroute('**/api/month*');

  // Switching districts while the first one is still loading must not let the
  // slower response repaint the list. Otherwise the user sees one district's
  // complexes under another district's name and picks a key that does not
  // exist there, which surfaces later as an unexplained 'not enough samples'.
  await page.route('**/api/month*', async (route) => {
    const url = new URL(route.request().url());
    const slow = url.searchParams.get('lawdCd') === '11110';
    const name = slow ? '느린구역단지' : '빠른구역단지';
    const kind = url.searchParams.get('kind');
    const shared = { name, key: name, area: 84, floor: 3, year: 2026, month: 6, day: 17 };
    const rows = kind === 'trade'
      ? [{ ...shared, price: 60000, cancelled: false }]
      : [{ ...shared, deposit: 35000, monthlyRent: 0 }];
    if (slow) await new Promise((resolve) => { setTimeout(resolve, 1500); });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ kind, rows }) });
  });
  await page.goto(baseURL + '/#diagnosis');
  // The previous test left a completed contract, which sends the wizard to
  // step 3 and hides the region selects. Reload to start from step 1.
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#sido-select option[value="서울특별시"]').waitFor({ state: 'attached' });
  await page.selectOption('#sido-select', '서울특별시');
  await page.selectOption('#district-select', '11110');
  await page.waitForTimeout(150);
  await page.selectOption('#district-select', '11140');
  await clickNext(page);
  await page.locator('#complex-list .complex-option').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(2000);
  const namesAfterSwitch = await page.locator('#complex-list .complex-option strong').allInnerTexts();
  assert.deepEqual(namesAfterSwitch, ['빠른구역단지'], `a stale district repainted the list: ${JSON.stringify(namesAfterSwitch)}`);
  results.push({ check: 'a slower district response cannot overwrite the current one', result: 'pass' });
  await page.unroute('**/api/month*');
  await page.goto(baseURL + '/#diagnosis');
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#sido-select option[value="세종특별자치시"]').waitFor({ state: 'attached' });
  await page.selectOption('#sido-select', '세종특별자치시');
  assert.equal(await page.locator('#district-select option[value="36110"]').count(), 1);
  await page.selectOption('#sido-select', '서울특별시');
  assert.equal(await page.locator('#district-select').inputValue(), '');
  results.push({ check: 'Sejong 36110 exists; region change clears district', result: 'pass' });
  await page.route('**/data/lawd.json', (route) => route.abort());
  await page.reload({ waitUntil: 'networkidle' });
  assert.match(await page.locator('#sido-select').innerText(), /불러오지 못/);
  results.push({ check: 'region network error displayed without fabricated fallback', result: 'pass' });
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  results.push({ check: 'no page errors or external API/asset requests', result: 'pass' });
  console.log(JSON.stringify({ status: 'passed', total: results.length, results, errors, externalRequests }, null, 2));
  await writeFile('artifacts/browser-results.json', JSON.stringify({ status: 'passed', total: results.length, results, errors, externalRequests }, null, 2));
} finally { await browser.close(); }
