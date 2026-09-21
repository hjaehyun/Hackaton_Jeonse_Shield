import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOPICS, selectPrecedents, precedentLink, normalizePrecedent } from '../src/lib/law.js';

// Shapes captured from the live API on 2026-09-21.
const listed = (over = {}) => ({
  판례일련번호: '618185',
  사건명: '배당이의[주택임대차보호법 제3조 제2항에서 정한 법인인 임차인이...]',
  사건번호: '2025다210305',
  선고일자: '2026.02.26',
  법원명: '대법원',
  ...over,
});

const body = (over = {}) => ({
  판시사항: '주택임대차보호법 제3조 제2항에 따라 입주자가 전세임대주택을 인도받고<br/> 주민등록을 마친 경우, 대항력이 소멸하는지 여부(적극)',
  참조조문: ' 주택임대차보호법 제3조 제1항, 제2항<br/>',
  사건명: '배당이의',
  사건번호: '2025다210305',
  선고일자: '20260226',
  법원명: '대법원',
  ...over,
});

test('every topic carries a query and its own plain-language line', () => {
  const keys = Object.keys(TOPICS);
  assert.ok(keys.length >= 3);
  for (const key of keys) {
    const topic = TOPICS[key];
    assert.ok(topic.query.length > 0, `${key} has no query`);
    assert.ok(topic.label.length > 0, `${key} has no label`);
    assert.ok(topic.guidance.length > 20, `${key} needs a sentence a non-lawyer can read`);
  }
});

// Only Supreme Court decisions carry 판시사항; lower courts return it empty.
// A card with an empty summary is worse than no card.
test('selectPrecedents keeps only Supreme Court decisions', () => {
  const rows = [
    listed({ 판례일련번호: '1', 법원명: '인천지방법원' }),
    listed({ 판례일련번호: '2', 법원명: '대법원' }),
    listed({ 판례일련번호: '3', 법원명: '' }),
  ];
  assert.deepEqual(selectPrecedents(rows, 5).map((r) => r['판례일련번호']), ['2']);
});

test('selectPrecedents caps how many it will ask bodies for', () => {
  const rows = Array.from({ length: 12 }, (_, i) => listed({ 판례일련번호: String(i) }));
  assert.equal(selectPrecedents(rows, 4).length, 4);
});

test('selectPrecedents tolerates a single object and an empty result', () => {
  assert.deepEqual(selectPrecedents(listed(), 3).length, 1);
  assert.deepEqual(selectPrecedents(null, 3), []);
  assert.deepEqual(selectPrecedents([], 3), []);
});

test('normalizePrecedent strips the markup the feed embeds in its text', () => {
  const row = normalizePrecedent(listed(), body());
  assert.ok(!row.summary.includes('<br'), 'line breaks must not reach the page as markup');
  assert.ok(!row.references.includes('<br'));
  assert.equal(row.references, '주택임대차보호법 제3조 제1항, 제2항');
});

test('normalizePrecedent formats the decision date for reading', () => {
  assert.equal(normalizePrecedent(listed({ 선고일자: '2026.02.26' }), body()).decidedOn, '2026.02.26');
  assert.equal(normalizePrecedent(listed({ 선고일자: '20260226' }), body()).decidedOn, '2026.02.26');
});

test('normalizePrecedent returns null when the court wrote no summary', () => {
  assert.equal(normalizePrecedent(listed(), body({ 판시사항: '' })), null);
  assert.equal(normalizePrecedent(listed(), body({ 판시사항: '   ' })), null);
  assert.equal(normalizePrecedent(listed(), null), null);
});

// The search is ordered by recency, not relevance, so '임대차보증금' surfaces
// inheritance and commercial-lease decisions. A precedent shown under a
// residential-tenancy heading has to actually be about residential tenancy.
test('normalizePrecedent rejects a decision that does not apply the housing act', () => {
  const commercial = body({
    판시사항: '상가건물 임대차보호법 제9조 제2항에 따라 임차인이 보증금을 반환받을 때까지...',
    참조조문: '상가건물 임대차보호법 제9조 제2항',
  });
  assert.equal(normalizePrecedent(listed(), commercial), null);

  const inheritance = body({
    판시사항: '민법 제1026조 제1호에서 ‘상속인이 상속재산에 대한 처분행위를 한 때’...',
    참조조문: '민법 제1026조',
  });
  assert.equal(normalizePrecedent(listed(), inheritance), null);
});

// 참조조문 reads '[1] 민법 제1026조 / [2] 민법 제105조 / [3] 주택임대차보호법...'
// so merely containing the act lets an inheritance dispute through. The first
// statute cited is the one the decision turns on.
test('normalizePrecedent rejects a decision that cites the housing act only in passing', () => {
  const inheritance = body({
    판시사항: '상속인이 상속재산에 대한 처분행위를 한 때의 의미',
    참조조문: '[1] 민법 제1026조 제1호 / [2] 민법 제105조 / [3] 주택임대차보호법 제3조',
  });
  assert.equal(normalizePrecedent(listed(), inheritance), null);
});

test('normalizePrecedent accepts a decision whose first citation is the housing act', () => {
  const numbered = normalizePrecedent(listed(), body({
    판시사항: '대항력이 소멸하는지 여부(적극)',
    참조조문: '[1] 주택임대차보호법 제3조 제1항 / [2] 민사집행법 제88조',
  }));
  assert.ok(numbered, 'a bracketed first citation counts');

  const bare = normalizePrecedent(listed(), body({
    판시사항: '대항력이 소멸하는지 여부(적극)',
    참조조문: '주택임대차보호법 제3조 제1항, 제2항, 제3조의2 제2항',
  }));
  assert.ok(bare, 'an unbracketed single citation counts');
});

test('normalizePrecedent rejects a decision with no citations to check', () => {
  assert.equal(normalizePrecedent(listed(), body({ 참조조문: '' })), null);
  assert.equal(normalizePrecedent(listed(), body({ 참조조문: '   ' })), null);
});

test('normalizePrecedent carries the identifiers a reader needs to verify it', () => {
  const row = normalizePrecedent(listed(), body());
  assert.equal(row.caseNumber, '2025다210305');
  assert.equal(row.court, '대법원');
  assert.ok(row.link.includes('618185'), 'the link must reach this precedent');
});

test('precedentLink points at the public case viewer, not the API', () => {
  const link = precedentLink('618185');
  assert.ok(link.startsWith('https://www.law.go.kr/'));
  assert.ok(!link.includes('OC='), 'the link must not carry our API credential');
  assert.ok(!link.includes('/DRF/'), 'the link must not point at the data endpoint');
});
