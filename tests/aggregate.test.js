import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listComplexes, complexTransactions, monthRangeLabel, missingRatioReason,
} from '../src/lib/aggregate.js';

const trade = (over = {}) => ({
  name: '삼익', key: '삼익', area: 84, price: 60000, floor: 3,
  year: 2026, month: 6, day: 17, cancelled: false, ...over,
});
const rent = (over = {}) => ({
  name: '삼익', key: '삼익', area: 84, deposit: 35000, monthlyRent: 0, floor: 5,
  year: 2026, month: 6, day: 25, ...over,
});

test('listComplexes groups rows by key and counts each feed', () => {
  const list = listComplexes(
    [trade(), trade(), trade({ name: '래미안', key: '래미안' })],
    [rent(), rent({ name: '래미안', key: '래미안' }), rent({ name: '래미안', key: '래미안' })],
  );
  const samik = list.find((c) => c.key === '삼익');
  assert.equal(samik.tradeCount, 2);
  assert.equal(samik.rentCount, 1);
  const raemian = list.find((c) => c.key === '래미안');
  assert.equal(raemian.tradeCount, 1);
  assert.equal(raemian.rentCount, 2);
});

test('listComplexes orders by how much evidence a complex has', () => {
  const list = listComplexes(
    [trade({ key: 'a', name: 'A' }), trade({ key: 'b', name: 'B' }), trade({ key: 'b', name: 'B' })],
    [rent({ key: 'c', name: 'C' })],
  );
  assert.deepEqual(list.map((c) => c.key), ['b', 'a', 'c']);
});

test('listComplexes shows the name from the most recent transaction', () => {
  const list = listComplexes([
    trade({ name: '삼익(구표기)', year: 2026, month: 1, day: 5 }),
    trade({ name: '삼익아파트', year: 2026, month: 8, day: 2 }),
  ], []);
  assert.equal(list[0].name, '삼익아파트');
});

test('listComplexes counts a cancelled trade as evidence but not as a trade', () => {
  const list = listComplexes([trade(), trade({ cancelled: true })], []);
  assert.equal(list[0].tradeCount, 1, 'a cancelled deal is not a transaction');
  assert.equal(list[0].cancelledCount, 1);
});

// The counts are what a user reads to judge whether a complex is worth
// picking. An entry showing 0 and 0 cannot justify its own presence.
test('listComplexes omits a complex whose only rows were cancelled', () => {
  assert.deepEqual(listComplexes([trade({ cancelled: true }), trade({ cancelled: true })], []), []);
});

test('listComplexes keeps a complex that has rentals but no sales', () => {
  const list = listComplexes([], [rent()]);
  assert.equal(list.length, 1);
  assert.equal(list[0].rentCount, 1);
  assert.equal(list[0].tradeCount, 0);
});

test('listComplexes tolerates empty and malformed input', () => {
  assert.deepEqual(listComplexes([], []), []);
  assert.deepEqual(listComplexes(null, undefined), []);
  assert.deepEqual(listComplexes([null, { key: null }], []), []);
});

test('complexTransactions returns only the chosen complex', () => {
  const result = complexTransactions('삼익',
    [trade(), trade({ key: '래미안', name: '래미안', price: 99999 })],
    [rent(), rent({ key: '래미안', name: '래미안' })]);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].price, 60000);
  assert.equal(result.rents.length, 1);
});

test('complexTransactions drops cancelled deals and reports how many', () => {
  const result = complexTransactions('삼익',
    [trade({ price: 60000 }), trade({ price: 999999, cancelled: true }), trade({ price: 62000 })],
    []);
  assert.deepEqual(result.trades.map((t) => t.price), [60000, 62000]);
  assert.equal(result.cancelledCount, 1);
});

test('complexTransactions names the complex from its most recent row', () => {
  const result = complexTransactions('삼익', [
    trade({ name: '삼익(구표기)', year: 2026, month: 1 }),
    trade({ name: '삼익아파트', year: 2026, month: 8 }),
  ], []);
  assert.equal(result.name, '삼익아파트');
});

test('complexTransactions returns empty lists for a key with nothing behind it', () => {
  const result = complexTransactions('없는단지', [trade()], [rent()]);
  assert.deepEqual(result.trades, []);
  assert.deepEqual(result.rents, []);
  assert.equal(result.cancelledCount, 0);
  assert.equal(result.name, null);
});

test('monthRangeLabel describes the window the rows came from', () => {
  assert.equal(monthRangeLabel(['202609', '202608', '202607']), '2026.07 ~ 2026.09');
  assert.equal(monthRangeLabel(['202601']), '2026.01');
  assert.equal(monthRangeLabel([]), null);
});

// Three different situations produce a blank ratio and they must not share a
// message: no sales at all, sales but none at this size, and too few at this
// size. '0건뿐입니다' for the middle one reads as a contradiction.
const ctx = { name: '삼익', rangeLabel: '2026.04 ~ 2026.09', area: 84 };

test('missingRatioReason names a complex that has not sold at all', () => {
  const reason = missingRatioReason({ ...ctx, tradeCount: 0, sampleSize: 0 });
  assert.equal(reason.kind, 'no-sales');
  assert.match(reason.lines.join(' '), /삼익/);
  assert.match(reason.lines.join(' '), /2026\.04 ~ 2026\.09/);
});

test('missingRatioReason separates "sold, but not at this size" from a thin sample', () => {
  const noneHere = missingRatioReason({ ...ctx, tradeCount: 30, sampleSize: 0 });
  assert.equal(noneHere.kind, 'no-comparable');
  assert.doesNotMatch(noneHere.lines.join(' '), /0건뿐/);
  assert.match(noneHere.lines.join(' '), /30건/, 'it should say the complex does sell');

  const thin = missingRatioReason({ ...ctx, tradeCount: 30, sampleSize: 2 });
  assert.equal(thin.kind, 'thin-sample');
  assert.match(thin.lines.join(' '), /2건/);
});

test('missingRatioReason always supplies a heading and at least one line', () => {
  for (const input of [
    { ...ctx, tradeCount: 0, sampleSize: 0 },
    { ...ctx, tradeCount: 5, sampleSize: 0 },
    { ...ctx, tradeCount: 5, sampleSize: 1 },
  ]) {
    const reason = missingRatioReason(input);
    assert.ok(reason.heading.length > 0);
    assert.ok(reason.lines.length >= 1);
  }
});