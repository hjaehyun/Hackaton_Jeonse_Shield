import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTopic, LawUnavailableError } from '../src/lib/law-client.js';

const ctx = { waitUntil: (p) => p };
const env = { LAW_OC: 'test-oc' };

function searchBody(rows) {
  return JSON.stringify({ PrecSearch: { totalCnt: rows.length, prec: rows } });
}
const listed = (id, court = '대법원') => ({
  판례일련번호: id, 사건명: `사건 ${id}`, 사건번호: `2025다${id}`,
  선고일자: '2026.02.26', 법원명: court,
});
function bodyFor(id, summary = `판시사항 ${id}`) {
  return JSON.stringify({
    PrecService: { 판시사항: summary, 참조조문: '주택임대차보호법 제3조', 사건번호: `2025다${id}` },
  });
}

function transport(handlers) {
  return async (url) => {
    const parsed = new URL(url);
    const isSearch = parsed.pathname.endsWith('lawSearch.do');
    const payload = isSearch ? handlers.search(parsed) : handlers.body(parsed);
    return { ok: true, status: 200, text: async () => payload };
  };
}

test('fetchTopic returns the topic guidance alongside the court summaries', async () => {
  const rows = await fetchTopic(env, ctx, 'opposing-power', transport({
    search: () => searchBody([listed('1'), listed('2'), listed('3')]),
    body: (u) => bodyFor(u.searchParams.get('ID')),
  }));
  assert.equal(rows.topic, 'opposing-power');
  assert.equal(rows.label, '대항력');
  assert.ok(rows.guidance.length > 20);
  assert.equal(rows.precedents.length, 3);
  assert.equal(rows.precedents[0].summary, '판시사항 1');
});

test('fetchTopic sends the OC from the environment and the topic query', async () => {
  let seen = null;
  await fetchTopic(env, ctx, 'renewal', transport({
    search: (u) => { seen = u; return searchBody([listed('9')]); },
    body: () => bodyFor('9'),
  }));
  assert.equal(seen.searchParams.get('OC'), 'test-oc');
  assert.equal(seen.searchParams.get('target'), 'prec');
  assert.equal(seen.searchParams.get('query'), '계약갱신요구');
});

test('fetchTopic drops decisions whose court wrote no summary', async () => {
  const rows = await fetchTopic(env, ctx, 'priority', transport({
    search: () => searchBody([listed('1'), listed('2'), listed('3')]),
    body: (u) => bodyFor(u.searchParams.get('ID'), u.searchParams.get('ID') === '2' ? '' : 'ok'),
  }));
  assert.deepEqual(rows.precedents.map((p) => p.id), ['1', '3']);
});

test('fetchTopic returns an empty list rather than failing when nothing matches', async () => {
  const rows = await fetchTopic(env, ctx, 'priority', transport({
    search: () => searchBody([]),
    body: () => bodyFor('x'),
  }));
  assert.deepEqual(rows.precedents, []);
  assert.ok(rows.guidance.length > 20, 'the plain-language line stands on its own');
});

test('fetchTopic rejects an unknown topic instead of querying for it', async () => {
  let called = false;
  await assert.rejects(
    () => fetchTopic(env, ctx, 'not-a-topic', async () => { called = true; }),
    (e) => e instanceof LawUnavailableError && e.code === 'UNKNOWN_TOPIC',
  );
  assert.equal(called, false);
});

// A zero-result search makes the body endpoint answer with an HTML error page.
test('fetchTopic treats a non-JSON response as unavailable, not as empty', async () => {
  await assert.rejects(
    () => fetchTopic(env, ctx, 'renewal', async () => ({
      ok: true, status: 200, text: async () => '<!DOCTYPE html><html>error</html>',
    })),
    (e) => e instanceof LawUnavailableError,
  );
});

test('fetchTopic raises LawUnavailableError on a transport failure', async () => {
  await assert.rejects(
    () => fetchTopic(env, ctx, 'renewal', async () => { throw new TypeError('fetch failed'); }),
    (e) => e instanceof LawUnavailableError && e.code === 'UPSTREAM_UNAVAILABLE',
  );
});

test('a fault in our own code is not disguised as the ministry being down', async () => {
  await assert.rejects(
    () => fetchTopic(env, ctx, 'renewal', async () => { throw new ReferenceError('helper is not defined'); }),
    (e) => e instanceof ReferenceError,
  );
});

test('fetchTopic defaults the OC when the environment does not set one', async () => {
  let seen = null;
  await fetchTopic({}, ctx, 'renewal', transport({
    search: (u) => { seen = u; return searchBody([]); },
    body: () => '{}',
  }));
  assert.equal(seen.searchParams.get('OC'), 'test');
});
