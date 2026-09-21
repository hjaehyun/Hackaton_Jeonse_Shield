import { test } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index.js';
test('health endpoint explicitly identifies mock mode', async () => {
  const response = await app.request('/api/health');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mode, 'mock');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});
test('debug route remains disabled even when a binding exists', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('No network calls are allowed in these tests'); };
  try {
    for (const kind of ['rent', 'trade']) {
      const response = await app.request(`/api/debug/sample?kind=${kind}`, {}, { DATA_GO_KR_KEY: 'test-only-not-a-real-key' });
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error, 'DEBUG_DISABLED');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  } finally { globalThis.fetch = original; }
});
test('enabled debug without a key fails closed without fetching', async () => {
  const response = await app.request('/api/debug/sample', {}, { ENABLE_API_DEBUG: 'true' });
  assert.equal(response.status, 503);
});
test('enabled debug rejects unsupported query values before fetching', async () => {
  for (const query of ['kind=other', 'lawdCd=bad', 'ym=202613']) {
    const response = await app.request(`/api/debug/sample?${query}`, {}, { ENABLE_API_DEBUG: 'true', DATA_GO_KR_KEY: 'test-only-not-a-real-key' });
    assert.equal(response.status, 400);
  }
});
test('unknown API paths return JSON 404', async () => {
  const response = await app.request('/api/not-existing');
  assert.equal(response.status, 404);
});
