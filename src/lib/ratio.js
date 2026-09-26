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
function comparableJeonse(rents, targetArea) {
  if (!Array.isArray(rents) || !Number.isFinite(targetArea) || targetArea <= 0) return [];
  return rents.filter((r) => r && Number.isFinite(r.area) && r.area > 0 &&
    Math.abs(r.area - targetArea) <= targetArea * 0.1 + Number.EPSILON * targetArea * 4 &&
    (r.monthlyRent ?? 0) === 0 &&
    Number.isFinite(r.deposit) && r.deposit > 0);
}

export function similarDeposits(rents, targetArea) {
  return comparableJeonse(rents, targetArea).map((r) => r.deposit).sort((a, b) => a - b);
}

// The filings the median was computed from, newest first. A reader who does not
// trust a median can read the rows it came from, and the two cannot disagree
// because both start from comparableJeonse.
const filedAt = (r) => (r.year ?? 0) * 10000 + (r.month ?? 0) * 100 + (r.day ?? 0);

// Sorting a copy keeps the caller's array in filing order, and the index
// tiebreak keeps same-day rows stable rather than engine-dependent.
function newestFirst(rows) {
  return rows
    .map((r, index) => ({ r, index }))
    .sort((a, b) => filedAt(b.r) - filedAt(a.r) || a.index - b.index)
    .map(({ r }) => r);
}

export function jeonseTransactions(rents, targetArea) {
  return newestFirst(comparableJeonse(rents, targetArea));
}

// --- 같은 단지 최근 실거래, 세 종류 ---
//
// Deliberately NOT filtered by area. The comparison above answers "is my
// deposit high for this size"; this answers "what is trading here lately",
// and narrowing it to +/-10% would leave most complexes with nothing to show.
// Each row prints its own 전용면적 so the reader can see the difference.
//
// Cancelled sales are counted and not listed. A deal the ministry withdrew is
// not a price anything traded at, which is the whole question this card
// answers, so putting it in the table with a badge would be answering a
// different one.
// --- 월세 시세 대비 ---
//
// A rent on its own says nothing. Measured on 경희궁자이 84㎡, the same complex
// in the same six months filed 4,000/440 and 125,000/20: deposit and rent trade
// against each other along a curve, so the median rent of all 38 filings
// describes no actual contract. Comparing a rent to it would be the conversion
// this report refuses, done implicitly.
//
// So the sample is narrowed to filings that bought a comparable deposit, and
// the deposit window is printed on screen. Within that band a rent is a rent.
export const DEPOSIT_BAND = 0.2;

// The window, and the window as the screen is allowed to state it.
//
// Rounding the ends outward puts a number on the card that the filter rejects:
// 5,579 x 1.2 is 6,694.8, and printing '~6,695만원' promises a range the table
// can never contain. Deposits are filed in whole 만원, so the inclusive integer
// bounds are exact — every integer between them passes, every integer outside
// fails — and those are what the card prints.
export function depositWindow(deposit) {
  if (!Number.isFinite(deposit) || deposit <= 0) return null;
  const low = deposit * (1 - DEPOSIT_BAND);
  const high = deposit * (1 + DEPOSIT_BAND);
  return { low, high, statedLow: Math.ceil(low), statedHigh: Math.floor(high) };
}

function nearArea(row, targetArea) {
  return row && Number.isFinite(row.area) && row.area > 0 &&
    Math.abs(row.area - targetArea) <= targetArea * 0.1 + Number.EPSILON * targetArea * 4;
}

// Monthly filings at a comparable size, before the deposit window narrows them.
// Exported because the 'no comparable deposit' message has to count exactly
// these rows: a second copy of the predicate in the UI drifts from this one and
// then the message contradicts the table.
export function nearbyWolse(rents, targetArea) {
  if (!Array.isArray(rents) || !Number.isFinite(targetArea) || targetArea <= 0) return [];
  return rents.filter((r) => nearArea(r, targetArea) &&
    Number.isFinite(r.monthlyRent) && r.monthlyRent > 0 &&
    Number.isFinite(r.deposit) && r.deposit > 0);
}

function comparableWolse(rents, targetArea, deposit) {
  const window = depositWindow(deposit);
  if (!window) return [];
  return nearbyWolse(rents, targetArea)
    .filter((r) => r.deposit >= window.low && r.deposit <= window.high);
}

export function wolseRatio(monthlyRent, rents, targetArea, deposit) {
  if (!Number.isFinite(monthlyRent) || monthlyRent <= 0) return null;
  const rows = comparableWolse(rents, targetArea, deposit);
  if (!rows.length) return null;
  const medianRent = median(rows.map((r) => r.monthlyRent).sort((a, b) => a - b));
  const ratio = (monthlyRent / medianRent) * 100;
  if (!Number.isFinite(ratio)) return null;
  const { low, high, statedLow, statedHigh } = depositWindow(deposit);
  return { ratio, sampleSize: rows.length, medianRent, depositLow: low, depositHigh: high, statedLow, statedHigh };
}

export function wolseDistribution(rents, targetArea, deposit) {
  const r = comparableWolse(rents, targetArea, deposit).map((x) => x.monthlyRent).sort((a, b) => a - b);
  const n = r.length;
  if (n < 3) return null;
  return { min: r[0], q1: r[Math.ceil(n * 0.25) - 1], median: median(r),
    q3: r[Math.ceil(n * 0.75) - 1], max: r[n - 1], sampleSize: n };
}

export function wolseTransactions(rents, targetArea, deposit) {
  return newestFirst(comparableWolse(rents, targetArea, deposit));
}

export function recentFilings(trades, rents, limit = 6) {
  const usableRent = (r) => r && Number.isFinite(r.area) && Number.isFinite(r.deposit) && r.deposit > 0;
  const rentRows = Array.isArray(rents) ? rents.filter(usableRent) : [];
  const saleRows = Array.isArray(trades)
    ? trades.filter((t) => t && Number.isFinite(t.area) && Number.isFinite(t.price) && t.price > 0)
    : [];

  // The split is exhaustive on purpose. Testing '> 0' on both sides would drop
  // a row whose monthlyRent is neither — the tiles would then sum to less than
  // the 전월세 count printed in the source line, with nothing saying why.
  const hasRent = (r) => Number.isFinite(r.monthlyRent) && r.monthlyRent > 0;
  const jeonse = newestFirst(rentRows.filter((r) => !hasRent(r)));
  const wolse = newestFirst(rentRows.filter(hasRent));
  const active = newestFirst(saleRows.filter((t) => !t.cancelled));

  const cap = Number.isInteger(limit) && limit > 0 ? limit : 6;
  return {
    jeonse: jeonse.slice(0, cap),
    wolse: wolse.slice(0, cap),
    sales: active.slice(0, cap),
    totals: { jeonse: jeonse.length, wolse: wolse.length, sales: active.length },
    cancelledSales: saleRows.length - active.length,
  };
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
