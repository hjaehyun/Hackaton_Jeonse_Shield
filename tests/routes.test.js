import { test } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index.js';

// Shapes captured from the live API on 2026-09-21, trimmed to the used fields.
const RENT_BODY = `<response><header><resultCode>000</resultCode></header><body><items>
<item><aptNm>삼익</aptNm><excluUseAr>55.57</excluUseAr><deposit>1,000</deposit><monthlyRent>50</monthlyRent><floor>10</floor><dealYear>2026</dealYear><dealMonth>6</dealMonth><dealDay>25</dealDay><umdNm>파장동</umdNm><buildYear>1978</buildYear></item>
</items></body></response>`;

const TRADE_BODY = `<response><header><resultCode>000</resultCode></header><body><items>
<item><aptNm>삼익</aptNm><excluUseAr>55.57</excluUseAr><dealAmount>30,000</dealAmount><floor>3</floor><dealYear>2026</dealYear><dealMonth>6</dealMonth><dealDay>17</dealDay><umdNm>파장동</umdNm><buildYear>1978</buildYear><cdealType> </cdealType><cdealDay> </cdealDay></item>
<item><aptNm>삼익</aptNm><excluUseAr>55.57</excluUseAr><dealAmount>99,999</dealAmount><floor>4</floor><dealYear>2026</dealYear><dealMonth>6</dealMonth><dealDay>18</dealDay><umdNm>파장동</umdNm><buildYear>1978</buildYear><cdealType>해제</cdealType><cdealDay>26.07.01</cdealDay></item>
</items></body></response>`;

function stubEnv(overrides = {}) {
  return {
    DATA_GO_KR_KEY: 'TEST_KEY',
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      text: async () => (String(url).includes('AptRent') ? RENT_BODY : TRADE_BODY),
    }),
    ...overrides,
  };
}

test('health endpoint reports its mode and sets the hardening headers', async () => {
  const response = await app.request('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('/api/month returns normalized rows for the requested feed', async () => {
  const response = await app.request('/api/month?kind=trade&lawdCd=11110&ym=202606', {}, stubEnv());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.kind, 'trade');
  assert.equal(body.lawdCd, '11110');
  assert.equal(body.ym, '202606');
  assert.equal(body.rows.length, 2);
  assert.equal(body.rows[0].price, 30000);
  assert.equal(body.rows[0].key, '삼익');
});

test('/api/month serves the rent feed from the rent endpoint', async () => {
  const response = await app.request('/api/month?kind=rent&lawdCd=11110&ym=202605', {}, stubEnv());
  const body = await response.json();
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0].deposit, 1000);
  assert.equal(body.rows[0].monthlyRent, 50);
});

test('/api/month keeps cancelled trades so the client can count them', async () => {
  const response = await app.request('/api/month?kind=trade&lawdCd=11110&ym=202604', {}, stubEnv());
  const body = await response.json();
  assert.equal(body.rows.filter((r) => r.cancelled).length, 1);
});

test('/api/month rejects a bad kind, region code or month before calling upstream', async () => {
  let called = false;
  const env = stubEnv({
    fetchImpl: async () => { called = true; return { ok: true, status: 200, text: async () => '' }; },
  });
  for (const query of [
    'kind=nope&lawdCd=11110&ym=202606',
    'kind=rent&lawdCd=111&ym=202606',
    'kind=rent&lawdCd=1111a&ym=202606',
    'kind=rent&lawdCd=11110&ym=2026',
    'kind=rent&lawdCd=11110&ym=202613',
    'kind=rent&lawdCd=11110&ym=202600',
    'kind=rent&lawdCd=11110',
  ]) {
    const response = await app.request(`/api/month?${query}`, {}, env);
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).error, 'INVALID_PARAMETERS', query);
  }
  assert.equal(called, false, 'a malformed request reached the upstream API');
});

test('/api/month fails closed when the key is missing', async () => {
  let called = false;
  const response = await app.request('/api/month?kind=rent&lawdCd=11110&ym=202606', {}, {
    fetchImpl: async () => { called = true; },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'KEY_NOT_CONFIGURED');
  assert.equal(called, false);
});

test('an upstream failure surfaces as 502 without leaking the key', async () => {
  const env = stubEnv({
    DATA_GO_KR_KEY: 'SECRET_KEY_VALUE',
    fetchImpl: async () => { throw new Error('connect ECONNREFUSED'); },
  });
  const response = await app.request('/api/month?kind=rent&lawdCd=11110&ym=202603', {}, env);
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.equal(JSON.parse(text).error, 'UPSTREAM_UNAVAILABLE');
  assert.ok(!text.includes('SECRET_KEY_VALUE'));
  assert.ok(!text.includes('serviceKey'));
});

test('a fault inside a 200 body is treated as a failure, not an empty month', async () => {
  const env = stubEnv({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => '<response><header><returnReasonCode>30</returnReasonCode></header></response>',
    }),
  });
  const response = await app.request('/api/month?kind=rent&lawdCd=11110&ym=202602', {}, env);
  assert.equal(response.status, 502);
});

test('the debug route is gone', async () => {
  const response = await app.request('/api/debug/sample?kind=rent', {}, stubEnv());
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'NOT_FOUND');
});

test('unknown API paths return JSON 404', async () => {
  const response = await app.request('/api/not-existing');
  assert.equal(response.status, 404);
});
