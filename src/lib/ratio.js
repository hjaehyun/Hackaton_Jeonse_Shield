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
