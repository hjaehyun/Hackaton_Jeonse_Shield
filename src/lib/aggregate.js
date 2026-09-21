// Turns the per-month rows the browser collected from /api/month into the two
// shapes the screens need. Pure functions, no I/O.
//
// Aggregation lives on the client because CPU is budgeted per Worker
// invocation: the route hands back one region-month at a time so parsing stays
// bounded, and the browser is the only place that sees every month at once.

import { activeTrades } from './rtms.js';

// Sortable integer for "when did this happen", used to pick the name a complex
// is currently known by. Complexes get renamed, and the newest filing wins.
function occurredAt(row) {
  return (row.year ?? 0) * 10000 + (row.month ?? 0) * 100 + (row.day ?? 0);
}

function usable(rows) {
  return Array.isArray(rows) ? rows.filter((row) => row && row.key) : [];
}

/**
 * One entry per complex that appears in either feed.
 *
 * `tradeCount` counts transactions that still stand; a deal the ministry later
 * cancelled is reported separately rather than inflating the count, because
 * the list is how a user judges whether a complex has enough evidence behind
 * it to be worth selecting.
 *
 * @returns {{key: string, name: string, tradeCount: number, rentCount: number, cancelledCount: number}[]}
 */
export function listComplexes(tradeRows, rentRows) {
  const byKey = new Map();

  const touch = (row, field) => {
    const entry = byKey.get(row.key)
      ?? { key: row.key, name: row.name ?? row.key, tradeCount: 0, rentCount: 0, cancelledCount: 0, at: -1 };
    entry[field] += 1;
    const at = occurredAt(row);
    if (at > entry.at) {
      entry.at = at;
      entry.name = row.name ?? entry.name;
    }
    byKey.set(row.key, entry);
  };

  for (const row of usable(tradeRows)) touch(row, row.cancelled ? 'cancelledCount' : 'tradeCount');
  for (const row of usable(rentRows)) touch(row, 'rentCount');

  return [...byKey.values()]
    .map(({ at, ...rest }) => rest)
    .sort((a, b) => (b.tradeCount + b.rentCount) - (a.tradeCount + a.rentCount)
      || a.key.localeCompare(b.key));
}

/**
 * Everything known about one complex.
 *
 * `trades` has cancelled deals removed — they would otherwise move the median,
 * which is the denominator of the jeonse ratio — and `cancelledCount` says how
 * many were removed so the screen can show it rather than quietly dropping rows.
 *
 * @returns {{key: string, name: string|null, trades: object[], rents: object[], cancelledCount: number}}
 */
export function complexTransactions(key, tradeRows, rentRows) {
  const mineTrades = usable(tradeRows).filter((row) => row.key === key);
  const mineRents = usable(rentRows).filter((row) => row.key === key);
  const kept = activeTrades(mineTrades);

  const newest = [...mineTrades, ...mineRents]
    .sort((a, b) => occurredAt(b) - occurredAt(a))[0];

  return {
    key,
    name: newest?.name ?? null,
    trades: kept,
    rents: mineRents,
    cancelledCount: mineTrades.length - kept.length,
  };
}

/** `'2026.07 ~ 2026.09'` — the window the rows were gathered from. */
export function monthRangeLabel(months) {
  if (!Array.isArray(months) || months.length === 0) return null;
  const sorted = [...months].sort();
  const pretty = (ym) => `${ym.slice(0, 4)}.${ym.slice(4)}`;
  const first = pretty(sorted[0]);
  const last = pretty(sorted[sorted.length - 1]);
  return first === last ? first : `${first} ~ ${last}`;
}
