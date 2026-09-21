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
    __TEST_FETCH__: async (url) => ({
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
    __TEST_FETCH__: async () => { called = true; return { ok: true, status: 200, text: async () => '' }; },
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
    __TEST_FETCH__: async () => { called = true; },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'KEY_NOT_CONFIGURED');
  assert.equal(called, false);
});

test('a transport failure surfaces as 502 without leaking the key', async () => {
  const env = stubEnv({
    DATA_GO_KR_KEY: 'SECRET_KEY_VALUE',
    // What fetch actually throws when it cannot reach the host.
    __TEST_FETCH__: async () => { throw new TypeError('fetch failed'); },
  });
  const response = await app.request('/api/month?kind=rent&lawdCd=11110&ym=202603', {}, env);
  assert.equal(response.status, 502);
  const text = await response.text();
  const body = JSON.parse(text);
  assert.equal(body.error, 'UPSTREAM_UNAVAILABLE');
  assert.equal(body.reason, 'TypeError', 'the 502 must say which class of failure it was');
  assert.ok(!text.includes('SECRET_KEY_VALUE'));
  assert.ok(!text.includes('serviceKey'));
  assert.ok(!text.includes('fetch failed'), 'the thrown message must not reach the body');
});

test('our own bug is not disguised as an upstream outage', async () => {
  // redirect: 'error' was rejected by workerd and accepted by Node, so a
  // blanket catch reported a code defect as an outage on every live request
  // while every test passed. A non-transport error must look different.
  const env = stubEnv({
    DATA_GO_KR_KEY: 'SECRET_KEY_VALUE',
    __TEST_FETCH__: async () => { throw new ReferenceError('someHelper is not defined'); },
  });
  const response = await app.request('/api/month?kind=rent&lawdCd=11110&ym=202601', {}, env);
  assert.equal(response.status, 500);
  const text = await response.text();
  assert.equal(JSON.parse(text).error, 'INTERNAL_ERROR');
  assert.ok(!text.includes('SECRET_KEY_VALUE'));
  assert.ok(!text.includes('someHelper'), 'the thrown message must not reach the body');
});

test('an upstream 403 is reported with its status, not as a network failure', async () => {
  const env = stubEnv({
    __TEST_FETCH__: async () => ({ ok: false, status: 403, text: async () => '' }),
  });
  const response = await app.request('/api/month?kind=trade&lawdCd=11110&ym=202512', {}, env);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).reason, 'http_403');
});

test('a non-function injected transport is ignored rather than called', async () => {
  // A real binding named __TEST_FETCH__ would be a string. Calling it would
  // throw TypeError and masquerade as an upstream outage.
  const env = { DATA_GO_KR_KEY: 'TEST_KEY', __TEST_FETCH__: 'not-a-function' };
  const original = globalThis.fetch;
  let usedGlobal = false;
  globalThis.fetch = async () => { usedGlobal = true; throw new TypeError('fetch failed'); };
  try {
    await app.request('/api/month?kind=rent&lawdCd=11110&ym=202511', {}, env);
    assert.equal(usedGlobal, true, 'the route must fall back to the real fetch');
  } finally {
    globalThis.fetch = original;
  }
});

test('a fault inside a 200 body is treated as a failure, not an empty month', async () => {
  const env = stubEnv({
    __TEST_FETCH__: async () => ({
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

const LAW_SEARCH = JSON.stringify({
  PrecSearch: {
    totalCnt: 1,
    prec: [{
      판례일련번호: '618185', 사건명: '배당이의', 사건번호: '2025다210305',
      선고일자: '2026.02.26', 법원명: '대법원',
    }],
  },
});
const LAW_BODY = JSON.stringify({
  PrecService: { 판시사항: '대항력이 언제 소멸하는지 여부(적극)', 참조조문: '주택임대차보호법 제3조' },
});

function lawEnv(overrides = {}) {
  return {
    LAW_OC: 'test',
    __TEST_FETCH__: async (url) => ({
      ok: true,
      status: 200,
      text: async () => (String(url).includes('lawSearch.do') ? LAW_SEARCH : LAW_BODY),
    }),
    ...overrides,
  };
}

test('/api/law returns the topic guidance and its precedents', async () => {
  const response = await app.request('/api/law?topic=opposing-power', {}, lawEnv());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.topic, 'opposing-power');
  assert.equal(body.label, '대항력');
  assert.ok(body.guidance.length > 20);
  assert.equal(body.precedents.length, 1);
  assert.equal(body.precedents[0].caseNumber, '2025다210305');
  assert.ok(body.precedents[0].link.includes('precInfoP.do'));
});

test('/api/law rejects an unknown topic before calling upstream', async () => {
  let called = false;
  const response = await app.request('/api/law?topic=nope', {}, lawEnv({
    __TEST_FETCH__: async () => { called = true; },
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'INVALID_PARAMETERS');
  assert.equal(called, false);
});

test('/api/law needs no service key, only the law account id', async () => {
  // DATA_GO_KR_KEY is absent here on purpose: the precedent API does not use it.
  const response = await app.request('/api/law?topic=priority', {}, lawEnv());
  assert.equal(response.status, 200);
});

test('a law lookup failure surfaces as 502 without leaking the account id', async () => {
  const response = await app.request('/api/law?topic=renewal', {}, lawEnv({
    LAW_OC: 'SECRET_OC_VALUE',
    __TEST_FETCH__: async () => { throw new TypeError('fetch failed'); },
  }));
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.equal(JSON.parse(text).error, 'UPSTREAM_UNAVAILABLE');
  assert.ok(!text.includes('SECRET_OC_VALUE'));
});