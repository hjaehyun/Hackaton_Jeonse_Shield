// Parsing helpers for the 국토교통부 실거래가 XML responses.
// Pure functions, no I/O, safe to import from the Worker and the browser.
//
// A general XML parser is deliberately avoided: the Workers free plan allows
// 10ms CPU per request, and every <item> here is a flat element with no
// nesting or attributes, so a scan is both sufficient and far cheaper.

const ITEM_RE = /<item>([\s\S]*?)<\/item>/g;
const FIELD_RE = /<([^/>\s]+)>([\s\S]*?)<\/\1>/g;

export function parseItems(xml) {
  if (typeof xml !== 'string' || !xml) return [];
  const rows = [];
  for (const item of xml.matchAll(ITEM_RE)) {
    const row = {};
    for (const field of item[1].matchAll(FIELD_RE)) {
      row[field[1]] = field[2].trim();
    }
    rows.push(row);
  }
  return rows;
}

// Amounts arrive as 만원 with thousands separators ("96,000"); areas as
// decimals ("97.61"). Blank fields arrive as a single space.
export function parseAmount(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// The trade response carries no aptSeq, so a rent row and a trade row can only
// be joined on the complex name. The rent feed appends a building range that
// the trade feed omits — "광화문스페이스본(101동~105동)" vs "광화문스페이스본" —
// so parenthesised segments are dropped, along with spacing and letter case.
// Digits are kept: "아남아파트 3차" and "아남아파트 2차" are different complexes.
//
// Consequence: two complexes distinguished only by a parenthesised segment
// collapse into one key. That is the intended trade-off — without aptSeq there
// is no way to tell a building range apart from a genuine name difference.
export function complexKey(name) {
  if (typeof name !== 'string') return null;
  const key = name
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  return key || null;
}

function baseFields(row) {
  return {
    year: parseAmount(row.dealYear),
    month: parseAmount(row.dealMonth),
    day: parseAmount(row.dealDay),
    dong: row.umdNm || null,
    buildYear: parseAmount(row.buildYear),
  };
}

export function normalizeRent(row) {
  if (!row || typeof row !== 'object') return null;
  const key = complexKey(row.aptNm);
  const area = parseAmount(row.excluUseAr);
  const deposit = parseAmount(row.deposit);
  if (!key || area === null || deposit === null) return null;
  return {
    name: row.aptNm,
    key,
    area,
    deposit,
    monthlyRent: parseAmount(row.monthlyRent) ?? 0,
    floor: parseAmount(row.floor),
    ...baseFields(row),
  };
}

// cdealType marks a deal the ministry later cancelled. Any non-empty value
// means cancelled; cdealDay carries the date when one is present.
export function normalizeTrade(row) {
  if (!row || typeof row !== 'object') return null;
  const key = complexKey(row.aptNm);
  const area = parseAmount(row.excluUseAr);
  const price = parseAmount(row.dealAmount);
  if (!key || area === null || price === null) return null;
  return {
    name: row.aptNm,
    key,
    area,
    price,
    floor: parseAmount(row.floor),
    ...baseFields(row),
    cancelled: Boolean((row.cdealType || '').trim()) || Boolean((row.cdealDay || '').trim()),
  };
}

// Cancelled deals stay in the feed. Leaving them in skews the median, which is
// the denominator of the jeonse ratio, so they are removed before any maths.
export function activeTrades(trades) {
  if (!Array.isArray(trades)) return [];
  return trades.filter((t) => t && !t.cancelled);
}
