import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recentMonths, fetchMonth, UpstreamError, RENT_URL, TRADE_URL,
} from '../src/lib/rtms-client.js';

const ctx = { waitUntil: (p) => p };
const env = { DATA_GO_KR_KEY: 'TEST_KEY' };

// Shapes captured from the live API on 2026-09-21, trimmed to the used fields.
const RENT_BODY = `<response><header><resultCode>000</resultCode></header><body><items>
<item><aptNm>삼익</aptNm><excluUseAr>55.57</excluUseAr><deposit>1,000</deposit><monthlyRent>50</monthlyRent><floor>10</floor><dealYear>2026</dealYear><dealMonth>6</dealMonth><dealDay>25</dealDay><umdNm>파장동</umdNm><buildYear>1978</buildYear></item>
</items><totalCount>1</totalCount></body></response>`;

const TRADE_BODY = `<response><header><resultCode>000</resultCode></header><body><items>
<item><aptNm>삼익</aptNm><excluUseAr>55.57</excluUseAr><dealAmount>30,000</dealAmount><floor>3</floor><dealYear>2026</dealYear><dealMonth>6</dealMonth><dealDay>17</dealDay><umdNm>파장동</umdNm><buildYear>1978</buildYear><cdealType> </cdealType><cdealDay> </cdealDay></item>
<item><aptNm>삼익</aptNm><excluUseAr>55.57</excluUseAr><dealAmount>99,999</dealAmount><floor>4</floor><dealYear>2026</dealYear><dealMonth>6</dealMonth><dealDay>18</dealDay><umdNm>파장동</umdNm><buildYear>1978</buildYear><cdealType>해제</cdealType><cdealDay>26.07.01</cdealDay></item>
</items><totalCount>2</totalCount></body></response>`;

const ok = (body) => async () => ({ ok: true, status: 200, text: async () => body });

test('recentMonths counts backwards from the given month, newest first', () => {
  assert.deepEqual(recentMonths(3, new Date('2026-09-21T00:00:00Z')), ['202609', '202608', '202607']);
});

test('recentMonths crosses the year boundary', () => {
  assert.deepEqual(recentMonths(3, new Date('2026-02-10T00:00:00Z')), ['202602', '202601', '202512']);
});

// Every user and every transaction is in KST. Reading the month in UTC loses
// the first nine hours of each month for a Korean audience.
test('recentMonths reads the month in Seoul time, not UTC', () => {
  // 2026-10-01 08:00 KST is still 2026-09-30 23:00 UTC.
  assert.equal(recentMonths(1, new Date('2026-09-30T23:00:00Z'))[0], '202610');
  // 2026-09-30 23:00 KST is 14:00 UTC the same day — still September.
  assert.equal(recentMonths(1, new Date('2026-09-30T14:00:00Z'))[0], '202609');
});

test('recentMonths crosses the year boundary in Seoul time', () => {
  // 2027-01-01 05:00 KST is 2026-12-31 20:00 UTC.
  assert.deepEqual(recentMonths(2, new Date('2026-12-31T20:00:00Z')), ['202701', '202612']);
});

test('the trade endpoint is the plain one, not the 403-only detail dataset', () => {
  assert.ok(TRADE_URL.endsWith('/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade'));
  assert.ok(!TRADE_URL.includes('TradeDev'));
});

test('fetchMonth sends the service key and the requested region and month', async () => {
  let seen = null;
  await fetchMonth(env, ctx, 'rent', '41111', '202606', async (url) => {
    seen = new URL(url);
    return { ok: true, status: 200, text: async () => RENT_BODY };
  });
  assert.ok(seen.href.startsWith(RENT_URL));
  assert.equal(seen.searchParams.get('serviceKey'), 'TEST_KEY');
  assert.equal(seen.searchParams.get('LAWD_CD'), '41111');
  assert.equal(seen.searchParams.get('DEAL_YMD'), '202606');
  assert.ok(Number(seen.searchParams.get('numOfRows')) <= 200, 'numOfRows must respect the CPU budget');
});

test('fetchMonth returns normalized rent rows', async () => {
  const rows = await fetchMonth(env, ctx, 'rent', '41111', '202606', ok(RENT_BODY));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deposit, 1000);
  assert.equal(rows[0].monthlyRent, 50);
  assert.equal(rows[0].area, 55.57);
  assert.equal(rows[0].key, '삼익');
});

test('fetchMonth keeps cancelled trades so the caller can count them', async () => {
  const rows = await fetchMonth(env, ctx, 'trade', '41111', '202607', ok(TRADE_BODY));
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.cancelled).length, 1);
});

test('fetchMonth raises UpstreamError on a non-200 response', async () => {
  await assert.rejects(
    () => fetchMonth(env, ctx, 'rent', '41111', '202601', async () => ({ ok: false, status: 403, text: async () => '' })),
    (e) => e instanceof UpstreamError && e.code === 'UPSTREAM_UNAVAILABLE',
  );
});

test('fetchMonth raises UpstreamError when a 200 body carries a fault code', async () => {
  const fault = '<response><header><returnReasonCode>30</returnReasonCode></header></response>';
  await assert.rejects(
    () => fetchMonth(env, ctx, 'rent', '41111', '202602', ok(fault)),
    (e) => e instanceof UpstreamError,
  );
});

test('an UpstreamError never carries the request URL or the service key', async () => {
  const error = await fetchMonth(env, ctx, 'rent', '41111', '202603', async () => {
    // What fetch throws when it cannot reach the host, with the URL in the
    // message the way a real runtime would include it.
    throw new TypeError('fetch failed https://apis.data.go.kr/x?serviceKey=TEST_KEY');
  }).then(() => null, (e) => e);
  assert.ok(error instanceof UpstreamError);
  const text = `${error.message} ${error.stack ?? ''} ${JSON.stringify(error)}`;
  assert.ok(!text.includes('TEST_KEY'), 'the service key leaked into the error');
  assert.ok(!text.includes('serviceKey'), 'the request URL leaked into the error');
});

test('the reason label says which class of transport failure it was', async () => {
  const error = await fetchMonth(env, ctx, 'rent', '41111', '202512', async () => {
    throw new TypeError('fetch failed');
  }).then(() => null, (e) => e);
  assert.equal(error.reason, 'TypeError');
});

// The blanket catch that used to live here disguised redirect: 'error' —
// rejected by workerd, accepted by Node — as an upstream outage on every live
// request while all unit tests passed.
test('a fault in our own code propagates instead of becoming an outage', async () => {
  const error = await fetchMonth(env, ctx, 'rent', '41111', '202511', async () => {
    throw new ReferenceError('someHelper is not defined');
  }).then(() => null, (e) => e);
  assert.ok(error instanceof ReferenceError, `expected the original error, got ${error?.name}`);
  assert.ok(!(error instanceof UpstreamError));
});
