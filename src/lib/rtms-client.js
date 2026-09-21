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

// KNOWN LIMITATION — tracked, not fixed.
//
// This takes the first page only. Busy districts return far more than this:
// Gangnam-gu had 2,096 rent transactions in 202606, of which we keep 200. The
// rows dropped are the tail of the month rather than a random sample, so the
// median we compute is biased, and the median is the denominator of the jeonse
// ratio. Fixing it means reading totalCount and paging, and re-measuring the
// CPU cost of parsing a full month. Until then the number shown for a busy
// district is computed from a partial month.
const ROWS_PER_MONTH = '200';

// Bumped whenever the shape or completeness of a cached body changes, so a
// fix does not keep serving yesterday's rows for a day.
const CACHE_VERSION = 'v1';

const CACHE_TTL_SECONDS = 86400;
const TIMEOUT_MS = 8000;

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

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

/**
 * `['202609', '202608', ...]`, newest first, counting back from `now`.
 *
 * Months are read in Asia/Seoul. Every user and every transaction is in KST,
 * so reading them in UTC would drop the first nine hours of each month.
 */
export function recentMonths(count, now = new Date()) {
  const seoul = new Date(now.getTime() + SEOUL_OFFSET_MS);
  const months = [];
  let year = seoul.getUTCFullYear();
  let month = seoul.getUTCMonth() + 1;
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
