// Month arithmetic, shared by the Worker and the browser.
//
// Kept apart from rtms-client.js so the browser can import it: that module
// pulls in the D1 cache, which has no meaning outside the Worker.

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * `['202609', '202608', ...]`, newest first, counting back from `now`.
 *
 * Months are read in Asia/Seoul. Every user and every transaction is in KST,
 * so reading them in UTC would drop the first nine hours of each month — at
 * 2026-10-01 08:00 KST it would ask for September and never October.
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
