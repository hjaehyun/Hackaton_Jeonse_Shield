import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listComplexes, complexTransactions, monthRangeLabel } from '../src/lib/aggregate.js';

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
