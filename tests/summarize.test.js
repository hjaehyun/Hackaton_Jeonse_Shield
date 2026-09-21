import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, acceptSummary, summarize, SUMMARY_VERSION } from '../src/lib/summarize.js';

const SOURCE = '주택임대차보호법 제3조 제2항에 따라 입주자가 전세임대주택을 인도받고 주민등록을 마침으로써 '
  + '법인인 임차인이 대항력을 갖추었는데 이후 입주자가 해당 주택을 양수함으로써 주택의 소유자가 된 경우, '
  + '임차인의 대항력이 입주자의 소유권 취득 시에 소멸하는지 여부(적극)';

const reply = (content) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }] }),
});

test('the prompt forbids adding anything the court did not say', () => {
  const prompt = buildPrompt(SOURCE);
  const joined = prompt.map((m) => m.content).join('\n');
  assert.match(joined, /판시사항/);
  assert.ok(joined.includes(SOURCE), 'the source text must be in the prompt');
  assert.match(joined, /추측|덧붙이지|없는 내용/, 'the model must be told not to invent');
  assert.match(joined, /조언|자문/, 'the model must be told not to give advice');
});

// A summary longer than its source has stopped summarising, and one that is a
// single clause has lost the holding. Both are cheap to detect.
test('acceptSummary rejects output that is not a summary', () => {
  assert.equal(acceptSummary('', SOURCE), null);
  assert.equal(acceptSummary('   ', SOURCE), null);
  assert.equal(acceptSummary(null, SOURCE), null);
  assert.equal(acceptSummary('짧음', SOURCE), null, 'too short to carry a holding');
  assert.equal(acceptSummary(SOURCE + SOURCE, SOURCE), null, 'longer than the source');
});

test('acceptSummary accepts a plain two-sentence answer', () => {
  const good = '법인이 빌린 전세임대주택에 입주자가 살면서 대항력이 생겼더라도, 그 입주자가 집을 사들여 주인이 되면 '
    + '대항력은 그 시점에 사라집니다. 주민등록이 더 이상 임차권을 알리는 표시가 아니기 때문입니다.';
  assert.equal(acceptSummary(good, SOURCE), good);
});

test('acceptSummary trims whitespace and surrounding quotes the model adds', () => {
  const body = '입주자가 집을 사들여 주인이 되면 법인 임차인의 대항력은 그때 사라집니다. 주민등록이 임차권을 알리는 표시가 아니게 되기 때문입니다.';
  assert.equal(acceptSummary(`  "${body}"  `, SOURCE), body);
});

test('summarize returns the accepted text and the model that produced it', async () => {
  const body = '입주자가 집을 사들여 주인이 되면 법인 임차인의 대항력은 그때 사라집니다. 주민등록이 임차권을 알리는 표시가 아니게 되기 때문입니다.';
  const result = await summarize({ UPSTAGE_API_KEY: 'k' }, SOURCE, reply(body));
  assert.equal(result.text, body);
  assert.ok(result.model.length > 0);
  assert.equal(result.version, SUMMARY_VERSION);
});

test('summarize sends the key as a bearer token and never in the body', async () => {
  let seenInit = null;
  await summarize({ UPSTAGE_API_KEY: 'SECRET' }, SOURCE, async (url, init) => {
    seenInit = init;
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x'.repeat(60) } }] }) };
  });
  assert.equal(seenInit.headers.Authorization, 'Bearer SECRET');
  assert.ok(!seenInit.body.includes('SECRET'), 'the key must not travel in the request body');
});

test('summarize returns null with no key rather than failing the page', async () => {
  let called = false;
  const result = await summarize({}, SOURCE, async () => { called = true; });
  assert.equal(result, null);
  assert.equal(called, false, 'no key means no request');
});

test('summarize returns null when the model is unreachable', async () => {
  assert.equal(await summarize({ UPSTAGE_API_KEY: 'k' }, SOURCE, async () => {
    throw new TypeError('fetch failed');
  }), null);
  assert.equal(await summarize({ UPSTAGE_API_KEY: 'k' }, SOURCE, async () => ({
    ok: false, status: 429, json: async () => ({}),
  })), null);
});

test('summarize returns null when the model answers with something unusable', async () => {
  assert.equal(await summarize({ UPSTAGE_API_KEY: 'k' }, SOURCE, reply('')), null);
  assert.equal(await summarize({ UPSTAGE_API_KEY: 'k' }, SOURCE, reply('네, 알겠습니다')), null);
  assert.equal(await summarize({ UPSTAGE_API_KEY: 'k' }, SOURCE, async () => ({
    ok: true, status: 200, json: async () => ({}),
  })), null);
});

test('a fault in our own code is not swallowed as an unavailable model', async () => {
  await assert.rejects(
    () => summarize({ UPSTAGE_API_KEY: 'k' }, SOURCE, async () => { throw new ReferenceError('nope'); }),
    (e) => e instanceof ReferenceError,
  );
});
