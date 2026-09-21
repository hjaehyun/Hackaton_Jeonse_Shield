import { Hono } from 'hono';

const app = new Hono();

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
});

app.get('/api/health', (c) => c.json({ status: 'ok', mode: 'mock', service: 'jeonse-shield' }));

// Temporary tomorrow-only inspector. Disabled unless explicitly enabled in env.
// No frontend calls this route. Delete it after field-name inspection is complete.
app.get('/api/debug/sample', async (c) => {
  c.header('Cache-Control', 'no-store');
  if (c.env?.ENABLE_API_DEBUG !== 'true') {
    return c.json({ error: 'DEBUG_DISABLED', message: '디버그 라우트는 비활성화되어 있습니다.' }, 404);
  }
  if (!c.env.DATA_GO_KR_KEY) return c.json({ error: 'KEY_NOT_CONFIGURED' }, 503);
  const kind = c.req.query('kind') ?? 'rent';
  const lawdCd = c.req.query('lawdCd') ?? '11110';
  const ym = c.req.query('ym') ?? '202607';
  if (!['rent', 'trade'].includes(kind) || !/^\d{5}$/.test(lawdCd) || !/^\d{4}(0[1-9]|1[0-2])$/.test(ym)) {
    return c.json({ error: 'INVALID_PARAMETERS' }, 400);
  }
  const endpoint = kind === 'trade'
    ? 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev'
    : 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';
  const url = new URL(endpoint);
  url.searchParams.set('serviceKey', c.env.DATA_GO_KR_KEY);
  url.searchParams.set('LAWD_CD', lawdCd);
  url.searchParams.set('DEAL_YMD', ym);
  url.searchParams.set('numOfRows', '3');
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    const xml = await response.text();
    return new Response(xml, { status: response.status, headers: {
      'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
      'x-cors-check': response.headers.get('access-control-allow-origin') ?? '(none)',
    } });
  } catch {
    // Do not log the URL or exception: either may contain the service key.
    return c.json({ error: 'UPSTREAM_UNAVAILABLE' }, 502);
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
