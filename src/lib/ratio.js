// Pure shared module. All monetary values are in 만원; areas are in ㎡.
export function similarPrices(trades, targetArea) {
  if (!Array.isArray(trades) || !Number.isFinite(targetArea) || targetArea <= 0) return [];
  return trades
    .filter((t) => t && Number.isFinite(t.area) && t.area > 0 &&
      Math.abs(t.area - targetArea) <= targetArea * 0.1 + Number.EPSILON * targetArea * 4)
    .map((t) => t.price)
    .filter((p) => Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);
}

function median(prices) {
  const n = prices.length;
  return n % 2 ? prices[(n - 1) / 2] : prices[n / 2 - 1] / 2 + prices[n / 2] / 2;
}

// Caller must supply trades from the same complex; the mock UI uses one fictional complex.
export function jeonseRatio(deposit, trades, targetArea) {
  if (!Number.isFinite(deposit) || deposit <= 0) return null;
  const prices = similarPrices(trades, targetArea);
  if (!prices.length) return null;
  const medianPrice = median(prices);
  const ratio = (deposit / medianPrice) * 100;
  if (!Number.isFinite(ratio)) return null;
  return { ratio, sampleSize: prices.length, medianPrice };
}

export function verdict(result) {
  if (!result || !Number.isInteger(result.sampleSize) || result.sampleSize < 3 ||
      !Number.isFinite(result.ratio) || result.ratio < 0) {
    return { level: 'unknown', label: '표본 부족 — 판정 불가' };
  }
  if (result.ratio < 60) return { level: 'safe', label: '안전' };
  if (result.ratio < 70) return { level: 'ok', label: '보통' };
  if (result.ratio < 80) return { level: 'caution', label: '주의' };
  return { level: 'danger', label: '위험 — 깡통전세 가능성' };
}

// Nearest rank for Q1/Q3: choose observed prices, never interpolate.
// No derived numeric statistics are exposed for insufficient samples.
export function tradeDistribution(trades, targetArea) {
  const p = similarPrices(trades, targetArea);
  const n = p.length;
  if (n < 3) return null;
  return { min: p[0], q1: p[Math.ceil(n * 0.25) - 1], median: median(p),
    q3: p[Math.ceil(n * 0.75) - 1], max: p[n - 1], sampleSize: n };
}

// --- The deposit against other deposits, rather than against sale prices ---
//
// jeonseRatio answers "could this deposit come back if the place is
// auctioned", which is a question about sale prices. It does not answer "am I
// being overcharged", which is the question the landing copy asks and which
// only other tenants' deposits can answer. The two are separate readings of
// the same contract and the report shows both.
//
// Monthly-rent deals are dropped rather than converted. A 보증금 of 5,000
// with 70 a month is not comparable to a 전세 deposit without assuming a
// conversion rate, and assuming one would put a number on screen that no
// filing contains.
export function similarDeposits(rents, targetArea) {
  if (!Array.isArray(rents) || !Number.isFinite(targetArea) || targetArea <= 0) return [];
  return rents
    .filter((r) => r && Number.isFinite(r.area) && r.area > 0 &&
      Math.abs(r.area - targetArea) <= targetArea * 0.1 + Number.EPSILON * targetArea * 4 &&
      (r.monthlyRent ?? 0) === 0)
    .map((r) => r.deposit)
    .filter((d) => Number.isFinite(d) && d > 0)
    .sort((a, b) => a - b);
}

export function marketRatio(deposit, rents, targetArea) {
  if (!Number.isFinite(deposit) || deposit <= 0) return null;
  const deposits = similarDeposits(rents, targetArea);
  if (!deposits.length) return null;
  const medianDeposit = median(deposits);
  const ratio = (deposit / medianDeposit) * 100;
  if (!Number.isFinite(ratio)) return null;
  return { ratio, sampleSize: deposits.length, medianDeposit };
}

// Deliberately not a risk scale. Paying above the local median is not a
// danger the way a high jeonseRatio is, so the bands describe position only
// and the wording stays neutral. The 10-point band around the median keeps a
// normal spread from reading as an anomaly.
export function marketVerdict(result) {
  if (!result || !Number.isInteger(result.sampleSize) || result.sampleSize < 3 ||
      !Number.isFinite(result.ratio) || result.ratio < 0) {
    return { level: 'unknown', label: '표본 부족 — 비교 불가' };
  }
  if (result.ratio < 100) return { level: 'below', label: '시세보다 낮음' };
  if (result.ratio < 110) return { level: 'at', label: '시세 수준' };
  return { level: 'above', label: '시세보다 높음' };
}

export function depositDistribution(rents, targetArea) {
  const d = similarDeposits(rents, targetArea);
  const n = d.length;
  if (n < 3) return null;
  return { min: d[0], q1: d[Math.ceil(n * 0.25) - 1], median: median(d),
    q3: d[Math.ceil(n * 0.75) - 1], max: d[n - 1], sampleSize: n };
}
