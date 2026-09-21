import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cached } from '../src/lib/cache.js';

// Mimics only the D1 surface the cache uses: prepare().bind().first()/run().
// No SQL is executed; the fake matches on the statement text.
function fakeD1(rows = new Map()) {
  const calls = [];
  const db = {
    rows,
    calls,
    prepare(sql) {
      calls.push(sql);
      let bound = [];
      const stmt = {
        bind(...args) { bound = args; return stmt; },
        async first() {
          if (!/SELECT/.test(sql)) return null;
          const [k, now] = bound;
          const hit = rows.get(k);
          return hit && hit.expires_at > now ? { v: hit.v } : null;
        },
        async run() {
          if (/INSERT/.test(sql)) {
            const [k, v, expiresAt] = bound;
            rows.set(k, { v, expires_at: expiresAt });
          }
          return { success: true };
        },
      };
      return stmt;
    },
  };
  return db;
}

const ctx = { waitUntil: (p) => p };

test('cached calls produce on a miss and returns its value', async () => {
  const db = fakeD1();
  let calls = 0;
  const value = await cached({ DB: db }, ctx, 'rent:11110:202606', 60, async () => {
    calls += 1;
    return { rows: [1, 2] };
  });
  assert.deepEqual(value, { rows: [1, 2] });
  assert.equal(calls, 1);
});

test('cached serves the stored value without calling produce again', async () => {
  const db = fakeD1();
  let calls = 0;
  const produce = async () => { calls += 1; return { rows: [1] }; };
  await cached({ DB: db }, ctx, 'k', 60, produce);
  const second = await cached({ DB: db }, ctx, 'k', 60, produce);
  assert.deepEqual(second, { rows: [1] });
  assert.equal(calls, 1, 'produce ran twice — the cache did not hit');
});

test('cached ignores an entry whose expiry has passed', async () => {
  const rows = new Map([['k', { v: JSON.stringify({ stale: true }), expires_at: 1 }]]);
  const db = fakeD1(rows);
  const value = await cached({ DB: db }, ctx, 'k', 60, async () => ({ fresh: true }));
  assert.deepEqual(value, { fresh: true });
});

test('cached works with no D1 binding at all', async () => {
  let calls = 0;
  const value = await cached({}, ctx, 'k', 60, async () => { calls += 1; return 'ok'; });
  assert.equal(value, 'ok');
  assert.equal(calls, 1);
});

test('cached creates its table once per isolate, not once per call', async () => {
  // The guard is module state, so a fresh import is the only honest way to
  // observe the first call. Other tests in this file have already tripped it.
  const fresh = await import(`../src/lib/cache.js?isolate=${Date.now()}`);
  const db = fakeD1();
  await fresh.cached({ DB: db }, ctx, 'a', 60, async () => 1);
  await fresh.cached({ DB: db }, ctx, 'b', 60, async () => 2);
  const creates = db.calls.filter((sql) => /CREATE TABLE/.test(sql));
  assert.equal(creates.length, 1, `CREATE TABLE ran ${creates.length} times`);
});

test('a write failure does not fail the request', async () => {
  const db = fakeD1();
  db.prepare = () => ({
    bind: () => ({
      first: async () => null,
      run: async () => { throw new Error('D1_ERROR'); },
    }),
  });
  const value = await cached({ DB: db }, ctx, 'k', 60, async () => 'ok');
  assert.equal(value, 'ok');
});

test('a read failure falls through to produce instead of throwing', async () => {
  const db = fakeD1();
  db.prepare = () => ({
    bind: () => ({
      first: async () => { throw new Error('D1_ERROR'); },
      run: async () => ({ success: true }),
    }),
  });
  const value = await cached({ DB: db }, ctx, 'k', 60, async () => 'ok');
  assert.equal(value, 'ok');
});

test('cached still returns when the runtime provides no waitUntil', async () => {
  const db = fakeD1();
  const value = await cached({ DB: db }, null, 'k', 60, async () => 'ok');
  assert.equal(value, 'ok');
});
