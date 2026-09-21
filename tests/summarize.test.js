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
  assert.equal(acceptSummary('가'.repeat(600), SOURCE), null, 'rambling, not summarising');
});

// Plain language is wordier than the court's. A terse 158-character 판시사항
// with two numbered holdings needs more than 158 characters to be readable, so
// 'shorter than the source' rejected summaries that were working.
test('acceptSummary allows a summary to run longer than a terse source', () => {
  const terse = '[1] 임차인의 계약갱신 요구와 이를 거절할 수 있는 사유를 정한 주택임대차보호법 제6조의3 제1항의 규정 취지 '
    + '[2] 임대인이 실제 거주를 이유로 갱신을 거절한 경우의 판단 기준';
  const plain = '임차인이 계약을 더 연장해 달라고 요구하면 임대인은 정해진 사유가 있을 때만 거절할 수 있습니다. '
    + '임대인이 직접 살겠다는 이유로 거절하려면 실제로 들어와 살 생각이 있어야 하고, 그 의사는 여러 사정을 함께 살펴 판단합니다.';
  assert.ok(plain.length > terse.length, 'this test only means something if the summary is longer');
  assert.equal(acceptSummary(plain, terse), plain);
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
