import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jeonseRatio, verdict, tradeDistribution, similarPrices } from '../src/lib/ratio.js';
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
