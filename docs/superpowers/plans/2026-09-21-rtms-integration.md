# 실거래가 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 목업 거래 14건을 국토교통부 실거래가 API 실데이터로 교체하고, 표본이 부족할 때 그 이유를 정직하게 알린다.

**Architecture:** Hono on Cloudflare Workers. 브라우저는 같은 오리진의 `/api/*`만 호출하고, Worker가 `serviceKey`를 쥔 채 공공데이터포털을 대신 호출한다. 업스트림 응답은 `lawdCd+ym` 단위로 D1에 24시간 캐시해 CPU 10ms 예산과 일 10,000건 쿼터를 지킨다. 매매 응답에 단지 ID가 없으므로 단지는 자유 입력이 아니라 목록에서 고르게 한다.

**Tech Stack:** Cloudflare Workers, Hono 4, D1, Vite Pages 빌드, `node:test`, Playwright

**Spec:** `docs/DESIGN.md`

## Global Constraints

- 런타임은 Cloudflare Workers다. Express, `process.env`, Node 내장 모듈(`fs`/`path`/`http`), 범용 XML 파서를 쓰지 않는다.
- `wrangler.jsonc`에 `kv_namespaces`를 넣지 않는다. 배포 검증에서 거부된다. 허용 바인딩은 D1과 R2뿐이다.
- 요청당 CPU 10ms. `numOfRows`는 200을 넘기지 않는다.
- `serviceKey`는 `c.env.DATA_GO_KR_KEY`로만 읽는다. 소스·설정·프론트엔드 번들에 문자열로 넣지 않는다.
- 업스트림 URL과 예외 객체를 로그나 오류 응답에 넣지 않는다. 둘 다 키를 포함할 수 있다.
- 매매 엔드포인트는 `RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade`다. `RTMSDataSvcAptTradeDev`는 403이며 쓰지 않는다.
- 파라미터 검증: `lawdCd`는 `/^\d{5}$/`, `ym`은 `/^\d{4}(0[1-9]|1[0-2])$/`.
- 표본이 3건 미만이면 비율·매매 통계·마커를 표시하지 않는다. 면적 허용범위 ±10%를 넓히거나 값을 보간하지 않는다.
- 화면에 찍는 모든 숫자는 관측값이다.
- 기존 테스트는 전부 통과해야 한다: `npm test` 36개, `node tests/browser.mjs` 48개.
- 커밋 메시지는 Conventional Commits. 본문은 한국어 또는 영어 서술문.

---

### Task 1: D1 캐시 계층

**Files:**
- Create: `src/lib/cache.js`
- Test: `tests/cache.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `cached(env, ctx, key, ttlSeconds, produce)` → `Promise<any>`
    `env.DB`가 없으면 `produce()` 결과를 그대로 반환한다. `ctx`는 `{ waitUntil(promise) }` 또는 `null`.
  - `CACHE_SCHEMA` → `string` (테스트가 참조)

- [ ] **Step 1: Write the failing test**

`tests/cache.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cached } from '../src/lib/cache.js';

// D1 의 prepare().bind().first()/run() 만 흉내낸다. 실제 SQL 은 실행하지 않는다.
function fakeD1(rows = new Map()) {
  const calls = [];
  return {
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
            const [k, v, expires_at] = bound;
            rows.set(k, { v, expires_at });
          }
          return { success: true };
        },
      };
      return stmt;
    },
  };
}
const ctx = { waitUntil: (p) => p };

test('cached calls produce on a miss and returns its value', async () => {
  const db = fakeD1();
  let calls = 0;
  const value = await cached({ DB: db }, ctx, 'rent:11110:202606', 60, async () => { calls += 1; return { rows: [1, 2] }; });
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
  const db = fakeD1();
  await cached({ DB: db }, ctx, 'a', 60, async () => 1);
  await cached({ DB: db }, ctx, 'b', 60, async () => 2);
  const creates = db.calls.filter((sql) => /CREATE TABLE/.test(sql));
  assert.equal(creates.length, 1, `CREATE TABLE ran ${creates.length} times`);
});

test('a write failure does not fail the request', async () => {
  const db = fakeD1();
  db.prepare = (sql) => ({
    bind: () => ({
      first: async () => null,
      run: async () => { throw new Error('D1_ERROR'); },
    }),
  });
  const value = await cached({ DB: db }, ctx, 'k', 60, async () => 'ok');
  assert.equal(value, 'ok');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cache.test.js`
Expected: FAIL — `Cannot find module '../src/lib/cache.js'`. 그다음 빈 스텁(`export async function cached(){}`)을 만들어 어설션 단계 실패를 확인한다.

- [ ] **Step 3: Write minimal implementation**

`src/lib/cache.js`:

```js
// D1 기반 응답 캐시.
// Genspark 배포 경로는 KV 바인딩을 거부하므로 D1 을 쓴다. D1 에는 TTL 이 없어
// expires_at 컬럼으로 만료를 직접 관리한다.
export const CACHE_SCHEMA = `
CREATE TABLE IF NOT EXISTS cache (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  expires_at INTEGER NOT NULL
)`;

// 배포 경로에서 마이그레이션을 돌릴 수 없을 수 있어 첫 요청에서 만든다.
// 아이솔레이트당 1회만 실행한다.
let schemaReady = false;

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.prepare(CACHE_SCHEMA).run();
  schemaReady = true;
}

export async function cached(env, ctx, key, ttlSeconds, produce) {
  const db = env?.DB;
  if (!db) return produce();

  const now = Math.floor(Date.now() / 1000);
  try {
    await ensureSchema(db);
    const hit = await db
      .prepare('SELECT v FROM cache WHERE k = ? AND expires_at > ?')
      .bind(key, now)
      .first();
    if (hit) return JSON.parse(hit.v);
  } catch {
    // 캐시를 읽지 못하는 것은 실패가 아니다. 업스트림으로 넘어간다.
  }

  const value = await produce();

  const write = db
    .prepare(
      `INSERT INTO cache (k, v, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v, expires_at = excluded.expires_at`,
    )
    .bind(key, JSON.stringify(value), now + ttlSeconds)
    .run()
    .catch(() => {});

  // 캐시 쓰기로 응답을 지연시키지 않는다.
  if (ctx?.waitUntil) ctx.waitUntil(write);

  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cache.test.js`
Expected: PASS 6/6

Run: `npm test`
Expected: PASS 42/42

- [ ] **Step 5: Commit**

```bash
git add src/lib/cache.js tests/cache.test.js
git commit -m "feat: add D1-backed response cache"
```

---

### Task 2: 업스트림 클라이언트

**Files:**
- Create: `src/lib/rtms-client.js`
- Test: `tests/rtms-client.test.js`

**Interfaces:**
- Consumes: `parseItems`, `normalizeRent`, `normalizeTrade`, `activeTrades` from `src/lib/rtms.js`; `cached` from `src/lib/cache.js`
- Produces:
  - `recentMonths(count, now)` → `string[]` — `['202609', '202608', ...]` 최신순
  - `RENT_URL`, `TRADE_URL` → `string`
  - `fetchMonth(env, ctx, kind, lawdCd, ym, fetchImpl)` → `Promise<object[]>`
    `kind`는 `'rent' | 'trade'`. 정규화된 행 배열. 해제 거래는 **제거하지 않는다**.
  - `fetchRange(env, ctx, kind, lawdCd, months, fetchImpl, now)` → `Promise<object[]>`
  - `UpstreamError` — `class extends Error`, `code = 'UPSTREAM_UNAVAILABLE'`

- [ ] **Step 1: Write the failing test**

`tests/rtms-client.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recentMonths, fetchMonth, fetchRange, UpstreamError, RENT_URL, TRADE_URL } from '../src/lib/rtms-client.js';

const ctx = { waitUntil: (p) => p };
const env = { DATA_GO_KR_KEY: 'TEST_KEY' };

const RENT_BODY = `<response><header><resultCode>000</resultCode></header><body><items>
<item><aptNm>삼익</aptNm><excluUseAr>55.57</excluUseAr><deposit>1,000</deposit><monthlyRent>50</monthlyRent><floor>10</floor><dealYear>2026</dealYear><dealMonth>6</dealMonth><dealDay>25</dealDay><umdNm>파장동</umdNm><buildYear>1978</buildYear></item>
</items><totalCount>1</totalCount></body></response>`;

const TRADE_BODY = `<response><header><resultCode>000</resultCode></header><body><items>
<item><aptNm>삼익</aptNm><excluUseAr>55.57</excluUseAr><dealAmount>30,000</dealAmount><floor>3</floor><dealYear>2026</dealYear><dealMonth>6</dealMonth><dealDay>17</dealDay><umdNm>파장동</umdNm><buildYear>1978</buildYear><cdealType> </cdealType><cdealDay> </cdealDay></item>
<item><aptNm>삼익</aptNm><excluUseAr>55.57</excluUseAr><dealAmount>99,999</dealAmount><floor>4</floor><dealYear>2026</dealYear><dealMonth>6</dealMonth><dealDay>18</dealDay><umdNm>파장동</umdNm><buildYear>1978</buildYear><cdealType>해제</cdealType><cdealDay>26.07.01</cdealDay></item>
</items><totalCount>2</totalCount></body></response>`;

const ok = (body) => async () => ({ ok: true, status: 200, text: async () => body });

test('recentMonths counts backwards from the given month, newest first', () => {
  assert.deepEqual(recentMonths(3, new Date('2026-09-21T00:00:00Z')), ['202609', '202608', '202607']);
});

test('recentMonths crosses the year boundary', () => {
  assert.deepEqual(recentMonths(3, new Date('2026-02-10T00:00:00Z')), ['202602', '202601', '202512']);
});

test('fetchMonth sends the service key and the requested region and month', async () => {
  let seen = null;
  await fetchMonth(env, ctx, 'rent', '41111', '202606', async (url) => {
    seen = new URL(url);
    return { ok: true, status: 200, text: async () => RENT_BODY };
  });
  assert.ok(seen.href.startsWith(RENT_URL));
  assert.equal(seen.searchParams.get('serviceKey'), 'TEST_KEY');
  assert.equal(seen.searchParams.get('LAWD_CD'), '41111');
  assert.equal(seen.searchParams.get('DEAL_YMD'), '202606');
  assert.ok(Number(seen.searchParams.get('numOfRows')) <= 200, 'numOfRows must respect the CPU budget');
});

test('fetchMonth returns normalized rent rows', async () => {
  const rows = await fetchMonth(env, ctx, 'rent', '41111', '202606', ok(RENT_BODY));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deposit, 1000);
  assert.equal(rows[0].monthlyRent, 50);
  assert.equal(rows[0].area, 55.57);
});

test('fetchMonth keeps cancelled trades so the caller can count them', async () => {
  const rows = await fetchMonth(env, ctx, 'trade', '41111', '202606', ok(TRADE_BODY));
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.cancelled).length, 1);
  assert.ok(seenUrlUsesTradeEndpoint());
  function seenUrlUsesTradeEndpoint() { return TRADE_URL.includes('RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade'); }
});

test('fetchMonth raises UpstreamError on a non-200 response', async () => {
  await assert.rejects(
    () => fetchMonth(env, ctx, 'rent', '41111', '202606', async () => ({ ok: false, status: 403, text: async () => '' })),
    (e) => e instanceof UpstreamError && e.code === 'UPSTREAM_UNAVAILABLE',
  );
});

test('fetchMonth raises UpstreamError when the body carries a fault code', async () => {
  const fault = '<response><header><returnReasonCode>30</returnReasonCode></header></response>';
  await assert.rejects(
    () => fetchMonth(env, ctx, 'rent', '41111', '202606', ok(fault)),
    (e) => e instanceof UpstreamError,
  );
});

test('an UpstreamError never carries the request URL or the service key', async () => {
  const error = await fetchMonth(env, ctx, 'rent', '41111', '202606', async () => { throw new Error('boom https://x?serviceKey=TEST_KEY'); })
    .then(() => null, (e) => e);
  const text = `${error.message} ${error.stack ?? ''}`;
  assert.ok(!text.includes('TEST_KEY'), 'the service key leaked into the error');
  assert.ok(!text.includes('serviceKey'), 'the request URL leaked into the error');
});

test('fetchRange concatenates every month it asked for', async () => {
  const asked = [];
  const rows = await fetchRange(env, ctx, 'rent', '41111', 3, async (url) => {
    asked.push(new URL(url).searchParams.get('DEAL_YMD'));
    return { ok: true, status: 200, text: async () => RENT_BODY };
  }, new Date('2026-09-21T00:00:00Z'));
  assert.deepEqual(asked, ['202609', '202608', '202607']);
  assert.equal(rows.length, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/rtms-client.test.js`
Expected: FAIL — 모듈 없음. 스텁을 만들어 어설션 실패를 확인한다.

- [ ] **Step 3: Write minimal implementation**

`src/lib/rtms-client.js`:

```js
import { parseItems, normalizeRent, normalizeTrade } from './rtms.js';
import { cached } from './cache.js';

export const RENT_URL = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';
// RTMSDataSvcAptTradeDev("상세 자료")는 별도 API 이며 이 키로는 403 이다.
export const TRADE_URL = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';

const ENDPOINT = { rent: RENT_URL, trade: TRADE_URL };
const NORMALIZE = { rent: normalizeRent, trade: normalizeTrade };

// numOfRows 는 CPU 10ms 예산 때문에 낮게 유지한다.
const ROWS_PER_MONTH = '200';
const CACHE_TTL_SECONDS = 86400;
const TIMEOUT_MS = 8000;

export class UpstreamError extends Error {
  constructor() {
    // 원인 문자열을 담지 않는다. 업스트림 URL 과 예외 메시지에는 serviceKey 가 들어 있다.
    super('upstream request failed');
    this.name = 'UpstreamError';
    this.code = 'UPSTREAM_UNAVAILABLE';
  }
}

export function recentMonths(count, now = new Date()) {
  const months = [];
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;
  for (let i = 0; i < count; i += 1) {
    months.push(`${year}${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month === 0) { month = 12; year -= 1; }
  }
  return months;
}

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
    response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    xml = await response.text();
  } catch {
    throw new UpstreamError();
  }
  // data.go.kr 는 200 안에 에러 XML 을 담아 보내기도 한다.
  if (!response.ok || /<returnReasonCode>/.test(xml)) throw new UpstreamError();

  return parseItems(xml).map(NORMALIZE[kind]).filter(Boolean);
}

export function fetchMonth(env, ctx, kind, lawdCd, ym, fetchImpl = fetch) {
  return cached(env, ctx, `${kind}:${lawdCd}:${ym}`, CACHE_TTL_SECONDS,
    () => callUpstream(env, kind, lawdCd, ym, fetchImpl));
}

export async function fetchRange(env, ctx, kind, lawdCd, months, fetchImpl = fetch, now = new Date()) {
  const rows = [];
  // 순차 호출이다. 서브리퀘스트 한도는 50 이고 months 는 최대 12 라 여유가 있다.
  for (const ym of recentMonths(months, now)) {
    rows.push(...await fetchMonth(env, ctx, kind, lawdCd, ym, fetchImpl));
  }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/rtms-client.test.js`
Expected: PASS 9/9

Run: `npm test`
Expected: PASS 51/51

- [ ] **Step 5: Commit**

```bash
git add src/lib/rtms-client.js tests/rtms-client.test.js
git commit -m "feat: add upstream client for the real-transaction API"
```

---

### Task 3: API 라우트

**Files:**
- Modify: `src/index.js`
- Test: `tests/routes.test.js`

**Interfaces:**
- Consumes: `fetchRange` from `src/lib/rtms-client.js`; `complexKey`, `activeTrades` from `src/lib/rtms.js`
- Produces: `GET /api/complexes`, `GET /api/complex` — 응답 형태는 `docs/DESIGN.md` 6절과 동일

- [ ] **Step 1: Write the failing test**

`tests/routes.test.js`에 추가:

```js
test('/api/complexes rejects a malformed region code before calling upstream', async () => {
  const response = await app.request('/api/complexes?lawdCd=111', {}, { DATA_GO_KR_KEY: 'k' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'INVALID_PARAMETERS');
});

test('/api/complexes fails closed when the key is missing', async () => {
  const response = await app.request('/api/complexes?lawdCd=11110', {}, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'KEY_NOT_CONFIGURED');
});

test('/api/complexes groups rows by complex key and counts both feeds', async () => {
  const response = await app.request('/api/complexes?lawdCd=11110&months=1', {}, stubEnv());
  const body = await response.json();
  assert.equal(response.status, 200);
  const target = body.complexes.find((c) => c.key === '삼익');
  assert.equal(target.name, '삼익');
  assert.equal(target.tradeCount, 2);
  assert.equal(target.rentCount, 1);
});

test('/api/complex removes cancelled trades and reports how many', async () => {
  const response = await app.request('/api/complex?lawdCd=11110&key=삼익&months=1', {}, stubEnv());
  const body = await response.json();
  assert.equal(body.cancelledCount, 1);
  assert.deepEqual(body.trades.map((t) => t.price), [30000]);
  assert.equal(body.rents.length, 1);
});

test('/api/complex returns empty lists for a key with no transactions', async () => {
  const response = await app.request('/api/complex?lawdCd=11110&key=없는단지&months=1', {}, stubEnv());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.trades, []);
  assert.deepEqual(body.rents, []);
});

test('an upstream failure surfaces as 502 without leaking the key', async () => {
  const env = { DATA_GO_KR_KEY: 'SECRET_KEY', fetchImpl: async () => { throw new Error('nope'); } };
  const response = await app.request('/api/complexes?lawdCd=11110&months=1', {}, env);
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.equal(JSON.parse(text).error, 'UPSTREAM_UNAVAILABLE');
  assert.ok(!text.includes('SECRET_KEY'));
});

test('the debug route is gone', async () => {
  const response = await app.request('/api/debug/sample?kind=rent', {}, stubEnv());
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'NOT_FOUND');
});
```

`stubEnv()`는 이 파일 상단에 둔다. Task 2의 `RENT_BODY` / `TRADE_BODY`를 그대로 쓴다:

```js
function stubEnv() {
  return {
    DATA_GO_KR_KEY: 'TEST_KEY',
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      text: async () => (url.includes('AptRent') ? RENT_BODY : TRADE_BODY),
    }),
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/routes.test.js`
Expected: FAIL — `/api/complexes`가 `NOT_FOUND` 404를 반환한다. 디버그 라우트 테스트는 아직 통과한다(삭제 전).

- [ ] **Step 3: Write minimal implementation**

`src/index.js`에서 `/api/debug/sample` 핸들러 **전체를 삭제**하고, `app.all('/api/*', ...)` 앞에 아래를 넣는다.
`wrangler.jsonc`의 `vars.ENABLE_API_DEBUG`도 지운다.

```js
import { fetchRange, UpstreamError } from './lib/rtms-client.js';
import { complexKey, activeTrades } from './lib/rtms.js';

const MAX_MONTHS = 12;

function readQuery(c) {
  const lawdCd = c.req.query('lawdCd') ?? '';
  const months = Number(c.req.query('months') ?? 6);
  if (!/^\d{5}$/.test(lawdCd)) return { error: 'INVALID_PARAMETERS' };
  if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) return { error: 'INVALID_PARAMETERS' };
  return { lawdCd, months };
}

// 테스트가 fetch 를 주입할 수 있게 env 를 통해 받는다. 배포 환경에는 없다.
const fetcher = (c) => c.env.fetchImpl ?? fetch;

async function loadBoth(c, lawdCd, months) {
  const impl = fetcher(c);
  const [rents, trades] = [
    await fetchRange(c.env, c.executionCtx, 'rent', lawdCd, months, impl),
    await fetchRange(c.env, c.executionCtx, 'trade', lawdCd, months, impl),
  ];
  return { rents, trades };
}

app.get('/api/complexes', async (c) => {
  const query = readQuery(c);
  if (query.error) return c.json({ error: query.error }, 400);
  if (!c.env.DATA_GO_KR_KEY) return c.json({ error: 'KEY_NOT_CONFIGURED' }, 503);

  let rents; let trades;
  try {
    ({ rents, trades } = await loadBoth(c, query.lawdCd, query.months));
  } catch (e) {
    return c.json({ error: e instanceof UpstreamError ? e.code : 'UPSTREAM_UNAVAILABLE' }, 502);
  }

  const byKey = new Map();
  const touch = (row, field) => {
    const entry = byKey.get(row.key) ?? { key: row.key, name: row.name, tradeCount: 0, rentCount: 0, at: -1 };
    entry[field] += 1;
    // 표기가 여럿이면 가장 최근 거래의 것을 대표로 쓴다.
    const at = row.year * 10000 + row.month * 100 + (row.day ?? 0);
    if (at > entry.at) { entry.at = at; entry.name = row.name; }
    byKey.set(row.key, entry);
  };
  for (const row of trades) touch(row, 'tradeCount');
  for (const row of rents) touch(row, 'rentCount');

  const complexes = [...byKey.values()]
    .map(({ at, ...rest }) => rest)
    .sort((a, b) => (b.tradeCount + b.rentCount) - (a.tradeCount + a.rentCount));

  return c.json({ lawdCd: query.lawdCd, months: query.months, complexes });
});

app.get('/api/complex', async (c) => {
  const query = readQuery(c);
  if (query.error) return c.json({ error: query.error }, 400);
  const key = complexKey(c.req.query('key'));
  if (!key) return c.json({ error: 'INVALID_PARAMETERS' }, 400);
  if (!c.env.DATA_GO_KR_KEY) return c.json({ error: 'KEY_NOT_CONFIGURED' }, 503);

  let rents; let trades;
  try {
    ({ rents, trades } = await loadBoth(c, query.lawdCd, query.months));
  } catch (e) {
    return c.json({ error: e instanceof UpstreamError ? e.code : 'UPSTREAM_UNAVAILABLE' }, 502);
  }

  const mineTrades = trades.filter((t) => t.key === key);
  const kept = activeTrades(mineTrades);
  const mineRents = rents.filter((r) => r.key === key);
  const newest = [...kept, ...mineRents].sort(
    (a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month),
  )[0];

  return c.json({
    key,
    name: newest?.name ?? c.req.query('key'),
    months: query.months,
    trades: kept.map(({ area, price, floor, year, month, day }) => ({ area, price, floor, year, month, day })),
    rents: mineRents.map(({ area, deposit, monthlyRent, floor, year, month, day }) => ({ area, deposit, monthlyRent, floor, year, month, day })),
    cancelledCount: mineTrades.length - kept.length,
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/routes.test.js`
Expected: PASS — 디버그 라우트 테스트 포함 전부 통과

Run: `npm test`
Expected: PASS

Run: `git grep -n "ENABLE_API_DEBUG\|debug/sample"` → 문서 외 코드 히트 0건

- [ ] **Step 5: Commit**

```bash
git add src/index.js wrangler.jsonc tests/routes.test.js
git commit -m "feat: serve complex listings and transactions from the real API"
```

---

### Task 4: 단지 선택 UI

**Files:**
- Modify: `public/index.html` (위저드 2단계 마크업)
- Modify: `public/app.js`
- Modify: `tests/browser.mjs`

**Interfaces:**
- Consumes: `GET /api/complexes`
- Produces: `contract.complexKey`, `contract.apartment` — Task 5가 쓴다

- [ ] **Step 1: Write the failing test**

`tests/browser.mjs`의 `fillToReport` 헬퍼를 목록 선택으로 바꾸고, 아래 검사를 추가한다:

```js
test: {
  await page.goto(baseURL + '/#diagnosis');
  await page.selectOption('#sido-select', '서울특별시');
  await page.selectOption('#district-select', '11110');
  await clickNext(page);
  // 단지 목록은 서버에서 온다. 자유 입력이 아니다.
  await page.locator('#complex-list .complex-option').first().waitFor({ state: 'visible' });
  assert.equal(await page.locator('#apartment-input').count(), 0, '자유 입력 필드가 남아 있다');
  const before = await page.locator('#complex-list .complex-option').count();
  await page.fill('#complex-filter', '없을만한이름zzz');
  assert.equal(await page.locator('#complex-list .complex-option').count(), 0);
  assert.match(await page.locator('#complex-empty').innerText(), /검색/);
  await page.fill('#complex-filter', '');
  assert.equal(await page.locator('#complex-list .complex-option').count(), before);
  await clickNext(page);
  assert.match(await page.locator('#form-error').innerText(), /단지/);
  results.push({ check: `${width}px complex list requires a selection`, result: 'pass' });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/browser.mjs`
Expected: FAIL — `#complex-list`가 존재하지 않는다

- [ ] **Step 3: Write minimal implementation**

`public/index.html`의 2단계 블록을 교체:

```html
<div class="form-step" data-step="2" hidden>
  <label class="field-label" for="complex-filter">단지 선택</label>
  <input id="complex-filter" type="search" placeholder="단지명으로 좁히기" autocomplete="off">
  <p id="complex-status" class="field-note" role="status">지역을 선택하면 단지를 불러옵니다.</p>
  <ul id="complex-list" class="complex-list" role="listbox" aria-labelledby="complex-filter"></ul>
  <p id="complex-empty" class="field-note" hidden>검색 조건에 맞는 단지가 없습니다.</p>
</div>
```

`public/app.js`에 추가:

```js
let complexes = [];
let selectedComplex = null;

async function loadComplexes(lawdCd) {
  $('#complex-status').textContent = '단지를 불러오는 중입니다...';
  $('#complex-list').innerHTML = '';
  complexes = [];
  selectedComplex = null;
  try {
    const response = await fetch(`/api/complexes?lawdCd=${encodeURIComponent(lawdCd)}&months=6`);
    if (!response.ok) throw new Error(String(response.status));
    complexes = (await response.json()).complexes;
  } catch {
    $('#complex-status').textContent = '단지 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
    return;
  }
  $('#complex-status').textContent = complexes.length
    ? `최근 6개월 거래가 있는 단지 ${complexes.length}곳`
    : '이 지역은 최근 6개월 아파트 거래가 없습니다.';
  renderComplexes('');
}

function renderComplexes(filter) {
  const needle = filter.replace(/\s+/g, '').toLowerCase();
  const shown = complexes.filter((c) => c.key.includes(needle));
  const list = $('#complex-list');
  list.innerHTML = '';
  for (const item of shown) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'complex-option';
    button.dataset.key = item.key;
    // 이용자에게 보이는 이름은 절대 HTML 로 삽입하지 않는다.
    button.textContent = item.name;
    const meta = document.createElement('small');
    meta.textContent = `매매 ${item.tradeCount}건 · 전월세 ${item.rentCount}건`;
    button.append(meta);
    button.addEventListener('click', () => {
      selectedComplex = item;
      $$('.complex-option').forEach((el) => el.classList.toggle('selected', el === button));
      clearError();
    });
    li.append(button);
    list.append(li);
  }
  $('#complex-empty').hidden = shown.length > 0 || complexes.length === 0;
}

$('#complex-filter').addEventListener('input', (event) => renderComplexes(event.target.value));
```

`#district-select`의 change 핸들러에서 `loadComplexes(value)`를 호출하고,
2단계 유효성 검사를 `if (!selectedComplex) return showError('단지를 선택해 주세요.')`로 바꾼다.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node tests/browser.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/style.css tests/browser.mjs
git commit -m "feat: pick the complex from real transactions instead of free text"
```

---

### Task 5: 결과 화면을 실데이터로

**Files:**
- Modify: `public/app.js` (`mockTrades` 삭제, `renderResult` 교체)
- Modify: `tests/browser.mjs`

**Interfaces:**
- Consumes: `GET /api/complex`, `contract.complexKey`
- Produces: 없음 (최종 소비자)

- [ ] **Step 1: Write the failing test**

`tests/browser.mjs`에 추가:

```js
{
  // 목업 배열이 남아 있으면 어떤 입력에도 같은 숫자가 나온다.
  const source = await page.evaluate(() => fetch('/app.js').then((r) => r.text()));
  assert.ok(!/mockTrades/.test(source), 'mockTrades is still bundled');
  results.push({ check: `${width}px no mock transactions remain`, result: 'pass' });
}
{
  // 매매 표본이 부족하면 비율을 숨기고 이유를 말한다.
  await selectComplexWithFewTrades(page);
  assert.equal(await page.locator('.ratio-value').count(), 0);
  assert.match(await page.locator('#ratio-content').innerText(), /매매 (거래가 없어|[0-9]+건)/);
  results.push({ check: `${width}px explains why a ratio is unavailable`, result: 'pass' });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/browser.mjs`
Expected: FAIL — `mockTrades is still bundled`

- [ ] **Step 3: Write minimal implementation**

`public/app.js`에서 `mockTrades` 배열(8~23행)을 삭제하고 `renderResult`를 비동기로 바꾼다:

```js
async function renderResult() {
  $('#result-status').textContent = '실거래가를 불러오는 중입니다...';
  let data;
  try {
    const url = `/api/complex?lawdCd=${encodeURIComponent(contract.lawdCd)}`
      + `&key=${encodeURIComponent(contract.complexKey)}&months=${contract.months ?? 6}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    data = await response.json();
  } catch {
    // 조회에 실패하면 숫자를 지어내지 않는다.
    $('#result-status').textContent = '실거래가를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
    $('#ratio-content').textContent = '';
    return;
  }
  $('#result-status').textContent = '';

  const trades = data.trades;
  const result = jeonseRatio(contract.deposit, trades, contract.area);
  const stats = tradeDistribution(trades, contract.area);
  const size = similarPrices(trades, contract.area).length;
  const decision = verdict(result);

  if (decision.level === 'unknown') {
    $('#ratio-content').textContent = trades.length === 0
      ? `${data.name}은(는) 최근 ${data.months}개월 매매 거래가 없어 전세가율을 계산할 수 없습니다.`
      : `전용 ${format(contract.area)}㎡ 부근 매매가 ${size}건뿐이라 중위가를 신뢰할 수 없습니다.`;
  }
  if (data.cancelledCount > 0) {
    $('#cancelled-note').textContent = `해제된 거래 ${data.cancelledCount}건을 제외했습니다.`;
  }
  // 이하 기존 렌더링 경로를 그대로 사용한다 (stats, decision, size).
}
```

`route()`에서 `renderResult()` 호출을 `await`로 바꾸고, 위저드 3단계 제출 시
`contract.lawdCd`와 `contract.complexKey`를 채운다.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npm test && node tests/browser.mjs`
Expected: 전부 PASS

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/index.html tests/browser.mjs
git commit -m "feat: compute the ratio from real transactions"
```

---

### Task 6: 실환경 검증과 문서

**Files:**
- Modify: `README.md`
- Modify: `docs/screenshots/*.png`

- [ ] **Step 1: 실제 키로 로컬 확인**

`.dev.vars`에 `DATA_GO_KR_KEY`가 있는 상태에서:

```bash
npm run build
npx wrangler pages dev dist --local --port 3000
```

서울 종로구 → 실제 단지 선택 → 84㎡ / 35,000만원으로 결과를 확인한다.
기대: 목업의 `58.3%`가 아닌 실제 계산값. 조회 기간과 표본 수가 표시된다.

- [ ] **Step 2: 캐시 적중 확인**

같은 지역을 두 번째 조회했을 때 업스트림 호출이 없는지 D1을 직접 본다:

```bash
npx wrangler d1 execute jeonse-shield --local --command "SELECT k, expires_at FROM cache ORDER BY k"
```

기대: `rent:11110:2026xx` 와 `trade:11110:2026xx` 행이 months 수만큼 존재.

- [ ] **Step 3: 키 노출 검사**

```bash
npm run build
grep -r "DATA_GO_KR_KEY\|serviceKey" dist/ || echo "clean"
git grep -nE "serviceKey=|[A-Za-z0-9+/]{40,}" -- . ':!*.md' ':!package-lock.json'
```

기대: `dist/`에 키 문자열 없음. git 히트는 API URL뿐.

- [ ] **Step 4: 스크린샷과 README 갱신**

```bash
node tests/browser.mjs
cp artifacts/landing-360.png artifacts/wizard-360.png artifacts/result-360.png docs/screenshots/
```

README에서 아래를 고친다:
- "1일차 목업" 서술을 실데이터 연동 상태로
- 진입 경로 목록에서 `/api/debug/sample` 삭제, `/api/complexes`·`/api/complex` 추가
- 데이터 구조 절의 "가상 단일 단지 14건" 삭제
- 테스트 개수 갱신

- [ ] **Step 5: Commit**

```bash
git add README.md docs/screenshots
git commit -m "docs: describe the live data integration"
```

---

## Self-Review

**Spec coverage**

| 설계서 절 | 구현 태스크 |
|---|---|
| 4. 데이터 소스 | Task 2 (`RENT_URL`/`TRADE_URL`, `TradeDev` 미사용) |
| 5.1 `aptSeq` 부재 → 목록 선택 | Task 3 (`/api/complexes`), Task 4 (UI) |
| 5.2 해제 거래 | Task 3 (`activeTrades` + `cancelledCount`) |
| 6. API 계약 | Task 3 |
| 7. 캐시 | Task 1, Task 2, Task 6 Step 2 |
| 8. 화면 변경 | Task 4, Task 5 |
| 9. 보안 | Task 3 (디버그 라우트 삭제), Task 6 Step 3 |
| 10. 정확성 원칙 | Task 5 (표본 부족 사유 구분), 기존 `ratio.js` |
| 13. 완료 기준 | Task 6 |

**Placeholder scan:** 없음. 모든 코드 단계에 실제 코드가 들어 있다.

**Type consistency:** `cached(env, ctx, key, ttl, produce)`는 Task 1이 정의하고 Task 2가 같은 시그니처로 호출한다. `fetchRange(env, ctx, kind, lawdCd, months, fetchImpl, now)`는 Task 2가 정의하고 Task 3이 같은 순서로 쓴다. `complexKey`/`activeTrades`는 기존 `rtms.js`의 것을 그대로 쓴다.

---

## 일정

오늘은 2026-09-21, 최종 제출은 2026-09-27 22:00이다.

| 날짜 | 태스크 |
|---|---|
| 9/22 (화) | Task 1, Task 2 |
| 9/23 (수) | Task 3 |
| 9/24 (목) | Task 4, Task 5 |
| 9/25 (금) | Task 6, 버퍼 |
| 9/26 (토) | 법령·판례 연동 또는 배포·갤러리 등록 |
| 9/27 (일) | 발표자료, 22시 전 제출 |

**버퍼 규칙:** 9/25까지 Task 6이 끝나지 않으면 법령·판례 연동을 버린다.
실거래가 연동이 완성된 쪽이 셋 다 반쯤 된 것보다 낫다.
