import { Hono } from 'hono';
import { fetchMonth, UpstreamError } from './lib/rtms-client.js';

const app = new Hono();

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
});

app.get('/api/health', (c) => c.json({ status: 'ok', service: 'jeonse-shield' }));

const KINDS = new Set(['rent', 'trade']);
const LAWD_CD = /^\d{5}$/;
const YEAR_MONTH = /^\d{4}(0[1-9]|1[0-2])$/;

// Hono's executionCtx getter throws when the runtime did not supply one, which
// is the case under app.request() in tests. The cache only needs it to defer a
// write, so a missing context is not an error.
function executionCtxOrNull(c) {
  try {
    return c.executionCtx;
  } catch {
    return null;
  }
}

// One region-month per request.
//
// CPU is budgeted per invocation, and a single month of one district can be
// 134KB of XML. Covering six months of both feeds in one request would mean
// parsing over a megabyte in one invocation, which the 10ms budget will not
// carry — and a cache hit would still have to JSON.parse every blob. The
// browser fans out across months instead and aggregates the rows itself.
app.get('/api/month', async (c) => {
  const kind = c.req.query('kind') ?? '';
  const lawdCd = c.req.query('lawdCd') ?? '';
  const ym = c.req.query('ym') ?? '';

  if (!KINDS.has(kind) || !LAWD_CD.test(lawdCd) || !YEAR_MONTH.test(ym)) {
    return c.json({ error: 'INVALID_PARAMETERS' }, 400);
  }
  if (!c.env?.DATA_GO_KR_KEY) return c.json({ error: 'KEY_NOT_CONFIGURED' }, 503);

  try {
    // env.fetchImpl exists only so tests can inject a transport.
    const rows = await fetchMonth(c.env, executionCtxOrNull(c), kind, lawdCd, ym, c.env.fetchImpl ?? fetch);
    return c.json({ kind, lawdCd, ym, rows });
  } catch (error) {
    // Never echo the cause. Both the request URL and anything fetch throws can
    // contain the service key.
    const code = error instanceof UpstreamError ? error.code : 'UPSTREAM_UNAVAILABLE';
    return c.json({ error: code }, 502);
  }
});

app.all('/api/*', (c) => c.json({ error: 'NOT_FOUND' }, 404));

// Pages / Hosted provide the native ASSETS fetch binding. The legacy Hono
// Workers serveStatic helper requires a KV manifest, unavailable in this stack.
app.use('/*', async (c, next) => {
  if (c.env?.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  await next();
});

app.notFound((c) => c.text('페이지를 찾을 수 없습니다.', 404));

export default app;
