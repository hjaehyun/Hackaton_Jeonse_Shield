// Talks to the 국토교통부 실거래가 API and hands back normalized rows.
// Everything that touches the service key lives here.

import { parseItems, normalizeRent, normalizeTrade } from './rtms.js';
import { cached } from './cache.js';
export { recentMonths } from './months.js';

export const RENT_URL = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';

// Not RTMSDataSvcAptTradeDev. That is the separate "상세 자료" dataset and it
// answers 403 for this service key; verified 2026-09-21.
export const TRADE_URL = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';

const ENDPOINT = { rent: RENT_URL, trade: TRADE_URL };
const NORMALIZE = { rent: normalizeRent, trade: normalizeTrade };

// KNOWN LIMITATION — tracked, not fixed.
//
// This takes the first page only. Busy districts return far more than this:
// Gangnam-gu had 2,096 rent transactions in 202606, of which we keep 200.
//
// Measured on the 202606 trade page for 11680: the 200 rows span days 1-30
// fairly evenly (45/30/30/34/28/33 per five-day bucket) and cover all 14
// legal dong, so the cut is not the tail of the month. What it does cost is
// per-complex depth. Those 200 rows spread over 110 complexes, only 19 of
// which reach the three-sale minimum, so a busy district falls back to
// '판정 불가' more often than its real transaction count warrants. The
// browser widens this by querying six months rather than one.
//
// Deliberately not fixed: paging on totalCount would multiply the parse cost
// that the 10ms CPU budget already constrains. Declining to rate a complex is
// the documented behaviour when a sample is thin, so the truncation costs
// coverage, not correctness.
const ROWS_PER_MONTH = '200';

// Bumped whenever the shape or completeness of a cached body changes, so a
// fix does not keep serving yesterday's rows for a day.
const CACHE_VERSION = 'v1';

const CACHE_TTL_SECONDS = 86400;
const TIMEOUT_MS = 8000;

export class UpstreamError extends Error {
  /** @param {string} reason Short, key-free label for what went wrong. */
  constructor(reason = 'unknown') {
    // Carries no cause and no detail beyond the label. The request URL and any
    // thrown message from fetch can both contain the service key.
    super('upstream request failed');
    this.name = 'UpstreamError';
    this.code = 'UPSTREAM_UNAVAILABLE';
    this.reason = reason;
  }
}

// Errors we expect from a healthy codebase talking to an unhealthy network.
// Anything else is a bug in this file and must not be disguised as an outage.
const NETWORK_ERROR_NAMES = new Set([
  'TypeError',        // fetch could not reach the host
  'AbortError',       // our own timeout fired
  'TimeoutError',     // AbortSignal.timeout in some runtimes
  'NetworkError',
]);

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
  } catch (error) {
    // A blanket catch here once disguised redirect:'error' — rejected by
    // workerd, accepted by Node — as an upstream outage for every live
    // request while all unit tests passed. Only transport failures are
    // translated; a bug in this function propagates so it can be seen.
    if (!NETWORK_ERROR_NAMES.has(error?.name)) throw error;
    throw new UpstreamError(error.name);
  }

  // data.go.kr returns faults inside a 200 body as often as it uses a status
  // code, so checking response.ok alone silently yields an empty list.
  if (!response.ok) throw new UpstreamError(`http_${response.status}`);
  if (/<returnReasonCode>/.test(xml)) throw new UpstreamError('fault_body');

  return parseItems(xml).map((row) => NORMALIZE[kind](row)).filter(Boolean);
}

/**
 * One region-month of transactions, cached for a day.
 *
 * Cancelled trades are left in. Dropping them is the caller's decision, and
 * the client-side aggregation in `public/lib/aggregate.js` reports how many it
 * dropped rather than discarding them silently.
 */
export function fetchMonth(env, ctx, kind, lawdCd, ym, fetchImpl = fetch) {
  return cached(
    env,
    ctx,
    `${CACHE_VERSION}:${kind}:${lawdCd}:${ym}`,
    CACHE_TTL_SECONDS,
    () => callUpstream(env, kind, lawdCd, ym, fetchImpl),
  );
}
