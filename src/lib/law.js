// 법제처 국가법령정보 판례 조회.
//
// No LLM summarises anything here. Supreme Court decisions carry 판시사항 —
// a summary the court wrote itself, 100 to 800 characters — so restating it
// through a model would add a hallucination risk and buy nothing. Lower courts
// return 판시사항 empty, which is why only Supreme Court decisions are kept.
//
// What reaches the screen is three layers, each honestly labelled: a plain
// sentence we wrote, the court's own summary, and a link to the full text.

const BASE = 'https://www.law.go.kr/DRF';

// Queries verified against the live API on 2026-09-21. '확정일자' and
// '소액임차인 최우선변제' are deliberately absent: both return lower-court
// decisions only, which have no 판시사항.
export const TOPICS = {
  'opposing-power': {
    label: '대항력',
    query: '주택임대차 대항력',
    guidance: '집이 팔리거나 경매에 넘어가도 계속 살 수 있는 힘입니다. 이사(점유)와 전입신고를 마친 다음 날부터 생깁니다.',
  },
  priority: {
    label: '우선변제권',
    query: '주택임대차 우선변제권',
    guidance: '경매 대금에서 다른 채권자보다 먼저 보증금을 받을 수 있는 권리입니다. 대항력에 더해 계약서에 확정일자를 받아야 합니다.',
  },
  'deposit-return': {
    label: '보증금 반환',
    // '임대차보증금' alone surfaces inheritance and commercial-lease cases:
    // the search is ordered by recency, not relevance.
    query: '주택임대차 보증금 반환',
    guidance: '계약이 끝나면 집을 비워 주는 것과 보증금을 돌려받는 것은 동시에 이루어져야 합니다. 집주인이 바뀌어도 반환 의무는 새 집주인에게 넘어갑니다.',
  },
  renewal: {
    label: '계약갱신요구권',
    query: '계약갱신요구',
    guidance: '계약 만료 6개월 전부터 2개월 전 사이에 갱신을 요구할 수 있습니다. 임대인이 실제 거주를 이유로 거절하는 경우가 분쟁이 됩니다.',
  },
};

// Every query returns decisions the search ranked by date, so a commercial
// lease or an inheritance dispute can sit at the top of '보증금 반환'. A
// precedent shown under a residential-tenancy heading must actually turn on
// the residential-tenancy act.
//
// Merely containing the act is too weak a test: 참조조문 reads
// '[1] 민법 제1026조 / [2] 민법 제105조 / [3] 주택임대차보호법 제3조', so an
// inheritance ruling that cites it in passing would pass. The first statute
// listed is the one the decision turns on, so that is what gets checked.
const HOUSING_ACT = '주택임대차보호법';

function turnsOnHousingAct(references) {
  if (!references) return false;
  const first = references.split('/')[0].replace(/^\[\d+\]\s*/, '').trim();
  return first.startsWith(HOUSING_ACT);
}

/** The public case viewer, which needs no credential. */
export function precedentLink(id) {
  return `https://www.law.go.kr/precInfoP.do?mode=0&precSeq=${encodeURIComponent(id)}`;
}

const clean = (value) => String(value ?? '')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Narrows a search result to the decisions worth asking bodies for.
 * Only 대법원 rows are kept: everything else returns 판시사항 empty, and a
 * card with no summary is worse than no card.
 */
export function selectPrecedents(rows, limit) {
  const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
  return list.filter((row) => row && row['법원명'] === '대법원').slice(0, limit);
}

/**
 * Combines a search row with its body. Returns null when the court wrote no
 * summary, because the summary is the only thing the card exists to show.
 */
export function normalizePrecedent(listed, body) {
  if (!listed || !body) return null;
  const summary = clean(body['판시사항']);
  if (!summary) return null;

  const references = clean(body['참조조문']);
  if (!turnsOnHousingAct(references)) return null;

  const raw = clean(listed['선고일자'] ?? body['선고일자']);
  const decidedOn = /^\d{8}$/.test(raw)
    ? `${raw.slice(0, 4)}.${raw.slice(4, 6)}.${raw.slice(6)}`
    : raw;

  return {
    id: String(listed['판례일련번호']),
    caseNumber: clean(listed['사건번호'] ?? body['사건번호']),
    court: clean(listed['법원명'] ?? body['법원명']),
    decidedOn,
    title: clean(listed['사건명'] ?? body['사건명']),
    summary,
    references,
    link: precedentLink(listed['판례일련번호']),
  };
}

export const SEARCH_URL = `${BASE}/lawSearch.do`;
export const BODY_URL = `${BASE}/lawService.do`;
