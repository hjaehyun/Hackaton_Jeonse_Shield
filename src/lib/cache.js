// D1-backed response cache.
//
// Three reasons this exists, in order of weight:
//   1. The Workers free plan allows 10ms CPU per request. A cache hit skips
//      XML parsing entirely, which is where that budget goes.
//   2. The development service key allows 10,000 upstream calls per day and one
//      diagnosis needs a dozen of them.
//   3. A cached region answers instantly, which matters when demoing.
//
// KV would be the natural fit but the Genspark deployment path rejects
// kv_namespaces; D1 and R2 are the only bindings it accepts. D1 has no TTL, so
// expiry is a column the reader compares against.

export const CACHE_SCHEMA = `
CREATE TABLE IF NOT EXISTS cache (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  expires_at INTEGER NOT NULL
)`;

const SELECT_SQL = 'SELECT v FROM cache WHERE k = ? AND expires_at > ?';

const UPSERT_SQL = `INSERT INTO cache (k, v, expires_at) VALUES (?, ?, ?)
  ON CONFLICT(k) DO UPDATE SET v = excluded.v, expires_at = excluded.expires_at`;

// The deployment path may not let us run migrations, so the table is created on
// first use. A module-level flag keeps that to once per isolate rather than
// once per request.
let schemaReady = false;

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.prepare(CACHE_SCHEMA).run();
  schemaReady = true;
}

/**
 * Returns the cached value for `key`, or calls `produce()` and stores it.
 *
 * The cache is never load-bearing: with no DB binding, or when D1 itself
 * errors, this degrades to calling `produce()` directly. Losing the cache
 * costs CPU and quota, not correctness.
 *
 * @param {{ DB?: object }} env       Worker bindings.
 * @param {{ waitUntil?: Function }|null} ctx  Execution context, if any.
 * @param {string} key
 * @param {number} ttlSeconds
 * @param {() => Promise<any>} produce
 */
export async function cached(env, ctx, key, ttlSeconds, produce) {
  const db = env?.DB;
  if (!db) return produce();

  const now = Math.floor(Date.now() / 1000);

  try {
    await ensureSchema(db);
    const hit = await db.prepare(SELECT_SQL).bind(key, now).first();
    if (hit) return JSON.parse(hit.v);
  } catch {
    // A cache we cannot read is a cache miss, not a failure.
  }

  const value = await produce();

  const write = (async () => {
    try {
      await db.prepare(UPSERT_SQL).bind(key, JSON.stringify(value), now + ttlSeconds).run();
    } catch {
      // A cache we cannot write is slower, not wrong.
    }
  })();

  // Writing must not delay the response.
  if (ctx?.waitUntil) ctx.waitUntil(write);

  return value;
}
