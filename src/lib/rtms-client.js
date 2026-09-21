// Talks to the 국토교통부 실거래가 API and hands back normalized rows.
// Everything that touches the service key lives here.

import { parseItems, normalizeRent, normalizeTrade } from './rtms.js';
import { cached } from './cache.js';

export const RENT_URL = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';

// Not RTMSDataSvcAptTradeDev. That is the separate "상세 자료" dataset and it
// answers 403 for this service key; verified 2026-09-21.
export const TRADE_URL = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';

const ENDPOINT = { rent: RENT_URL, trade: TRADE_URL };
const NORMALIZE = { rent: normalizeRent, trade: normalizeTrade };

// Kept low on purpose: parsing is what spends the 10ms CPU budget.
const ROWS_PER_MONTH = '200';
const CACHE_TTL_SECONDS = 86400;
const TIMEOUT_MS = 8000;

export class UpstreamError extends Error {
  constructor() {
    // Carries no cause and no detail. The request URL and any thrown message
    // from fetch can both contain the service key.
    super('upstream request failed');
    this.name = 'UpstreamError';
    this.code = 'UPSTREAM_UNAVAILABLE';
  }
}

/** `['202609', '202608', ...]`, newest first, counting back from `now`. */
export function recentMonths(count, now = new Date()) {
  const months = [];
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;
  for (let i = 0; i < count; i += 1) {
    months.push(`${year}${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}

async function callUpstream(env, kind, lawdCd, ym, fetchImpl) {
  const url = new URL(ENDPOINT[kind]);
  url.searchParams.set('serviceKey', env.DATA_GO_KR_KEY);
  url.searchParams.set('LAWD_CD', lawdCd);
  url.searchParams.set('DEAL_YMD', ym);
  url.searchParams.set('numOfRows', ROWS_PER_MONTH);
  url.searchParams.set('pageNo', '1');

  let response;
  let xml;
  try {
    response = await fetchImpl(url.toString(), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // 'manual' rather than 'error': workerd rejects redirect: 'error' at the
      // fetch call, and Node does not, so a unit test cannot catch it. Either
      // way a redirect must not be followed — the URL carries the service key
      // and following one would hand it to whatever host the redirect names.
      // With 'manual' the 3xx comes back as a non-ok response and fails below.
      redirect: 'manual',
    });
    xml = await response.text();
  } catch {
    // Deliberately swallowing the cause: see UpstreamError.
    throw new UpstreamError();
  }

  // data.go.kr returns faults inside a 200 body as often as it uses a status
  // code, so checking response.ok alone silently yields an empty list.
  if (!response.ok || /<returnReasonCode>/.test(xml)) throw new UpstreamError();

  return parseItems(xml).map(NORMALIZE[kind]).filter(Boolean);
}

/**
 * One region-month of transactions, cached for a day.
 * Cancelled trades are left in — the caller decides whether to count or drop
 * them, and `/api/complex` reports how many it dropped.
 */
export function fetchMonth(env, ctx, kind, lawdCd, ym, fetchImpl = fetch) {
  return cached(
    env,
    ctx,
    `${kind}:${lawdCd}:${ym}`,
    CACHE_TTL_SECONDS,
    () => callUpstream(env, kind, lawdCd, ym, fetchImpl),
  );
}

/**
 * The last `months` months of transactions for one region.
 *
 * Sequential on purpose. The subrequest ceiling is 50 per request and `months`
 * is capped at 12, so there is room, and running them in series keeps a cold
 * region from opening a dozen sockets at once.
 *
 * A failure on any month throws rather than returning a short list: a silently
 * truncated range would move the median.
 */
export async function fetchRange(env, ctx, kind, lawdCd, months, fetchImpl = fetch, now = new Date()) {
  const rows = [];
  for (const ym of recentMonths(months, now)) {
    rows.push(...await fetchMonth(env, ctx, kind, lawdCd, ym, fetchImpl));
  }
  return rows;
}
