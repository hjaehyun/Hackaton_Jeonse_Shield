import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jeonseRatio, verdict, tradeDistribution, similarPrices,
  similarDeposits, depositDistribution, marketRatio, marketVerdict,
  jeonseTransactions, recentFilings,
  wolseRatio, wolseDistribution, wolseTransactions,
} from '../src/lib/ratio.js';
const trades = (prices, area = 84) => prices.map((price) => ({ name: '가상 단지', area, price }));
test('0 samples return null and unknown verdict', () => {
  assert.equal(jeonseRatio(35000, [], 84), null);
  assert.equal(verdict(null).level, 'unknown');
  assert.equal(tradeDistribution([], 84), null);
});
test('2 samples cannot produce a displayable verdict or distribution', () => {
  const result = jeonseRatio(35000, trades([50000, 60000]), 84);
  assert.equal(result.sampleSize, 2);
  assert.equal(verdict(result).label, '표본 부족 — 판정 불가');
  assert.equal(tradeDistribution(trades([50000, 60000]), 84), null);
});
test('5 samples: exact median, sample count and ratio', () => {
  assert.deepEqual(jeonseRatio(35000, trades([70000, 40000, 60000, 50000, 55000]), 84), {
    ratio: 35000 / 55000 * 100, sampleSize: 5, medianPrice: 55000,
  });
});
for (const [ratio, level] of [[59.9, 'safe'], [60, 'ok'], [69.9, 'ok'], [70, 'caution'], [79.9, 'caution'], [80, 'danger'], [120, 'danger']]) {
  test(`verdict boundary ${ratio} -> ${level}`, () => {
    assert.equal(verdict({ ratio, sampleSize: 5 }).level, level);
    assert.equal(verdict(jeonseRatio(ratio * 1000, trades([100000, 100000, 100000]), 84)).level, level);
  });
}
test('even sample median averages central observed values', () => {
  assert.equal(jeonseRatio(25000, trades([10000, 20000, 40000, 50000]), 84).medianPrice, 30000);
});
test('area includes exact +/-10 percent and excludes everything beyond', () => {
  const data = [89.999, 90, 100, 110, 110.001].map((area) => ({ area, price: area }));
  assert.deepEqual(similarPrices(data, 100), [90, 100, 110]);
  assert.equal(similarPrices(trades([1], 75.6), 84).length, 1);
});
test('invalid areas / deposits / prices never introduce non-finite values', () => {
  for (const input of [0, -1, NaN, Infinity, undefined, '84']) assert.equal(jeonseRatio(1, trades([1, 2, 3]), input), null);
  for (const input of [0, -1, NaN, Infinity, undefined, '100']) assert.equal(jeonseRatio(input, trades([1, 2, 3]), 84), null);
  assert.deepEqual(similarPrices([null, { area: 84, price: Infinity }, ...trades([0, -10, NaN, '2', 30000])], 84), [30000]);
  assert.equal(verdict({ ratio: NaN, sampleSize: 5 }).level, 'unknown');
});
test('input array and objects are unchanged', () => {
  const input = Object.freeze(trades([70000, 50000, 60000]).map(Object.freeze));
  jeonseRatio(30000, input, 84);
  assert.deepEqual(input.map((t) => t.price), [70000, 50000, 60000]);
});
test('nearest-rank quartiles never interpolate', () => {
  assert.deepEqual(tradeDistribution(trades([10, 20, 30, 40, 50]), 84), {
    min: 10, q1: 20, median: 30, q3: 40, max: 50, sampleSize: 5,
  });
});

// --- 전세 시세 대비 (deposit against other jeonse deposits in the same complex) ---

const rents = (deposits, area = 84, monthlyRent = 0) =>
  deposits.map((deposit) => ({ name: '가상 단지', area, deposit, monthlyRent }));

test('monthly-rent contracts are excluded: no conversion rate is assumed', () => {
  const mixed = [...rents([100000, 110000, 120000]), ...rents([5000, 6000], 84, 70)];
  assert.deepEqual(similarDeposits(mixed, 84), [100000, 110000, 120000]);
  assert.equal(marketRatio(30000, mixed, 84).sampleSize, 3);
});
test('a complex with only monthly-rent deals produces no market ratio', () => {
  const monthly = rents([5000, 6000, 7000, 8000], 84, 50);
  assert.deepEqual(similarDeposits(monthly, 84), []);
  assert.equal(marketRatio(30000, monthly, 84), null);
  assert.equal(depositDistribution(monthly, 84), null);
});
test('under three jeonse deals the ratio and distribution are withheld', () => {
  const thin = rents([100000, 120000]);
  assert.equal(depositDistribution(thin, 84), null);
  assert.equal(marketRatio(30000, thin, 84).sampleSize, 2);
  assert.equal(marketVerdict(marketRatio(30000, thin, 84)).level, 'unknown');
});
test('market ratio divides by the median jeonse deposit', () => {
  assert.deepEqual(marketRatio(30000, rents([104500, 123000, 135000]), 84), {
    ratio: 30000 / 123000 * 100, sampleSize: 3, medianDeposit: 123000,
  });
});
test('deposit distribution uses nearest-rank on observed deposits', () => {
  assert.deepEqual(depositDistribution(rents([135000, 104500, 123000, 110000, 130000]), 84), {
    min: 104500, q1: 110000, median: 123000, q3: 130000, max: 135000, sampleSize: 5,
  });
});
test('market ratio honours the same +/-10 percent area window', () => {
  const spread = [89.999, 90, 100, 110, 110.001].map((area) => ({ area, deposit: area * 1000, monthlyRent: 0 }));
  assert.deepEqual(similarDeposits(spread, 100), [90000, 100000, 110000]);
});
test('market verdict bands: at or below the market is not flagged', () => {
  for (const [ratio, level] of [[85, 'below'], [95, 'below'], [100, 'at'], [109.9, 'at'], [110, 'above']]) {
    assert.equal(marketVerdict({ ratio, sampleSize: 5 }).level, level);
  }
});
test('invalid rent rows never introduce non-finite values', () => {
  assert.deepEqual(similarDeposits([null, { area: 84, deposit: Infinity, monthlyRent: 0 },
    { area: 84, deposit: 0, monthlyRent: 0 }, ...rents([120000])], 84), [120000]);
  for (const input of [0, -1, NaN, Infinity, undefined, '84']) assert.equal(marketRatio(1, rents([1, 2, 3]), input), null);
  for (const input of [0, -1, NaN, Infinity, undefined, '100']) assert.equal(marketRatio(input, rents([1, 2, 3]), 84), null);
});
test('rent input array and objects are unchanged', () => {
  const input = Object.freeze(rents([120000, 100000, 110000]).map(Object.freeze));
  marketRatio(30000, input, 84);
  assert.deepEqual(input.map((r) => r.deposit), [120000, 100000, 110000]);
});

// --- 최근 전세 실거래 목록 (the rows behind the median, newest first) ---

const dated = (rows) => rows.map((r) => ({
  name: '가상 단지', area: 84, monthlyRent: 0, floor: 5, ...r,
}));

test('transactions come back newest first', () => {
  const rows = dated([
    { deposit: 110000, year: 2026, month: 4, day: 20 },
    { deposit: 130000, year: 2026, month: 9, day: 2 },
    { deposit: 120000, year: 2026, month: 6, day: 17 },
    { deposit: 125000, year: 2026, month: 6, day: 30 },
  ]);
  assert.deepEqual(jeonseTransactions(rows, 84).map((r) => r.deposit),
    [130000, 125000, 120000, 110000]);
});
test('the transaction list obeys the same filters as the median', () => {
  const rows = dated([
    { deposit: 120000, year: 2026, month: 6, day: 1 },
    { deposit: 5000, monthlyRent: 120, year: 2026, month: 7, day: 1 },
    { deposit: 130000, area: 120, year: 2026, month: 8, day: 1 },
  ]);
  const shown = jeonseTransactions(rows, 84);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].deposit, 120000);
  // Whatever the table lists is exactly what the median was computed from.
  assert.deepEqual(shown.map((r) => r.deposit).sort((a, b) => a - b), similarDeposits(rows, 84));
});
test('rows missing a usable deposit never reach the table', () => {
  const rows = [null, { area: 84, deposit: 0, monthlyRent: 0 },
    { area: 84, deposit: Infinity, monthlyRent: 0 }, ...dated([{ deposit: 120000 }])];
  assert.deepEqual(jeonseTransactions(rows, 84).map((r) => r.deposit), [120000]);
  assert.deepEqual(jeonseTransactions([], 84), []);
  assert.deepEqual(jeonseTransactions(dated([{ deposit: 120000 }]), 0), []);
});
test('listing transactions does not reorder or mutate the caller array', () => {
  const input = Object.freeze(dated([
    { deposit: 110000, year: 2026, month: 4, day: 20 },
    { deposit: 130000, year: 2026, month: 9, day: 2 },
  ]).map(Object.freeze));
  jeonseTransactions(input, 84);
  assert.deepEqual(input.map((r) => r.deposit), [110000, 130000]);
});
test('a missing filing date sorts last rather than throwing', () => {
  const rows = dated([{ deposit: 120000 }, { deposit: 130000, year: 2026, month: 9, day: 2 }]);
  delete rows[0].year;
  assert.deepEqual(jeonseTransactions(rows, 84).map((r) => r.deposit), [130000, 120000]);
});

// --- 같은 단지 최근 실거래 (three kinds, newest first, capped) ---

test('filings split into jeonse, wolse and sales, newest first', () => {
  const rentRows = [
    { area: 84, deposit: 120000, monthlyRent: 0, year: 2026, month: 5, day: 1 },
    { area: 59, deposit: 90000, monthlyRent: 0, year: 2026, month: 8, day: 1 },
    { area: 84, deposit: 5000, monthlyRent: 120, year: 2026, month: 7, day: 1 },
  ];
  const tradeRows = [
    { area: 84, price: 250000, year: 2026, month: 4, day: 1 },
    { area: 84, price: 260000, year: 2026, month: 9, day: 1 },
  ];
  const out = recentFilings(tradeRows, rentRows, 6);
  assert.deepEqual(out.jeonse.map((r) => r.deposit), [90000, 120000]);
  assert.deepEqual(out.wolse.map((r) => r.deposit), [5000]);
  assert.deepEqual(out.sales.map((r) => r.price), [260000, 250000]);
});
test('recent filings ignore the area window: this is the whole complex', () => {
  const rentRows = [{ area: 26, deposit: 40000, monthlyRent: 0, year: 2026, month: 6, day: 1 }];
  assert.equal(recentFilings([], rentRows, 6).jeonse.length, 1);
});
test('cancelled sales are counted, not listed', () => {
  const tradeRows = [
    { area: 84, price: 250000, year: 2026, month: 6, day: 1 },
    { area: 84, price: 990000, year: 2026, month: 7, day: 1, cancelled: true },
  ];
  const out = recentFilings(tradeRows, [], 6);
  assert.deepEqual(out.sales.map((r) => r.price), [250000]);
  assert.equal(out.cancelledSales, 1);
});
test('each list is capped and the total says how many exist', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({
    area: 84, deposit: 100000 + i, monthlyRent: 0, year: 2026, month: 1 + i, day: 1,
  }));
  const out = recentFilings([], many, 6);
  assert.equal(out.jeonse.length, 6);
  assert.equal(out.totals.jeonse, 9);
  // Newest six, so the highest month numbers.
  assert.deepEqual(out.jeonse.map((r) => r.deposit), [100008, 100007, 100006, 100005, 100004, 100003]);
});
test('rows without a usable amount never reach any list', () => {
  const out = recentFilings(
    [null, { area: 84, price: 0 }, { area: 84, price: 250000, year: 2026, month: 6, day: 1 }],
    [null, { area: 84, deposit: Infinity, monthlyRent: 0 }],
    6,
  );
  assert.equal(out.sales.length, 1);
  assert.equal(out.jeonse.length, 0);
  assert.equal(out.wolse.length, 0);
});
test('recent filings do not mutate the caller arrays', () => {
  const rentRows = Object.freeze([
    Object.freeze({ area: 84, deposit: 110000, monthlyRent: 0, year: 2026, month: 4, day: 1 }),
    Object.freeze({ area: 84, deposit: 130000, monthlyRent: 0, year: 2026, month: 9, day: 1 }),
  ]);
  recentFilings([], rentRows, 6);
  assert.deepEqual(rentRows.map((r) => r.deposit), [110000, 130000]);
});

// --- 월세 시세 대비 (rent compared only against comparable deposits) ---

const wolseRows = (pairs, area = 84) =>
  pairs.map(([deposit, monthlyRent]) => ({ name: '가상 단지', area, deposit, monthlyRent }));

test('the rent sample is confined to filings with a comparable deposit', () => {
  // Deposit and rent trade off against each other, so a rent only means
  // something next to rents that bought the same deposit.
  const rows = wolseRows([[4000, 440], [20000, 420], [22000, 400], [18000, 430], [90000, 140]]);
  const out = wolseRatio(420, rows, 84, 20000);
  assert.equal(out.sampleSize, 3);
  assert.equal(out.medianRent, 420);
  assert.deepEqual([out.depositLow, out.depositHigh], [16000, 24000]);
  assert.equal(out.ratio, 100);
});
test('jeonse filings are never part of a rent comparison', () => {
  const rows = [...wolseRows([[20000, 400], [20000, 420], [20000, 440]]),
    { area: 84, deposit: 20000, monthlyRent: 0 }];
  assert.equal(wolseRatio(400, rows, 84, 20000).sampleSize, 3);
});
test('a rent comparison needs three filings at a comparable deposit', () => {
  const rows = wolseRows([[20000, 400], [20000, 420], [90000, 140], [95000, 150]]);
  const thin = wolseRatio(400, rows, 84, 20000);
  assert.equal(thin.sampleSize, 2);
  assert.equal(marketVerdict(thin).level, 'unknown');
  assert.equal(wolseDistribution(rows, 84, 20000), null);
});
test('rent bands read the same way the jeonse ones do', () => {
  const rows = wolseRows([[20000, 400], [20000, 400], [20000, 400]]);
  assert.equal(marketVerdict(wolseRatio(399, rows, 84, 20000)).level, 'below');
  assert.equal(marketVerdict(wolseRatio(400, rows, 84, 20000)).level, 'at');
  assert.equal(marketVerdict(wolseRatio(440, rows, 84, 20000)).level, 'above');
});
test('rent distribution uses nearest-rank on observed rents', () => {
  const rows = wolseRows([[20000, 440], [20000, 390], [20000, 400], [20000, 430], [20000, 420]]);
  assert.deepEqual(wolseDistribution(rows, 84, 20000), {
    min: 390, q1: 400, median: 420, q3: 430, max: 440, sampleSize: 5,
  });
});
test('rent filings come back newest first', () => {
  const rows = [
    { area: 84, deposit: 20000, monthlyRent: 400, year: 2026, month: 4, day: 1 },
    { area: 84, deposit: 20000, monthlyRent: 420, year: 2026, month: 9, day: 1 },
  ];
  assert.deepEqual(wolseTransactions(rows, 84, 20000).map((r) => r.monthlyRent), [420, 400]);
});
test('a rent comparison never introduces non-finite values', () => {
  const rows = wolseRows([[20000, 400], [20000, 420], [20000, 440]]);
  for (const bad of [0, -1, NaN, Infinity, undefined, '400']) {
    assert.equal(wolseRatio(bad, rows, 84, 20000), null);
    assert.equal(wolseRatio(400, rows, 84, bad), null);
    assert.equal(wolseRatio(400, rows, bad, 20000), null);
  }
  assert.deepEqual(wolseTransactions([], 84, 20000), []);
});
test('a rent comparison does not mutate the caller array', () => {
  const input = Object.freeze(wolseRows([[20000, 440], [20000, 390]]).map(Object.freeze));
  wolseRatio(400, input, 84, 20000);
  assert.deepEqual(input.map((r) => r.monthlyRent), [440, 390]);
});
