import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jeonseRatio, verdict, tradeDistribution, similarPrices,
  similarDeposits, depositDistribution, marketRatio, marketVerdict,
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
