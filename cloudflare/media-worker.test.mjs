import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './media-worker.mjs';
const valid = 'https://media.pxster.xyz/media-delivery/12345678-1234-1234-1234-123456789012?expires=9999999999&signature=' + 'a'.repeat(64);
test('rejects unrelated routes, writes, and missing or expired signatures', async () => {
  assert.equal((await worker.fetch(new Request('https://media.pxster.xyz/auth/me'))).status, 404);
  assert.equal((await worker.fetch(new Request(valid, {method:'POST'}))).status, 405);
  assert.equal((await worker.fetch(new Request(valid.split('?')[0]))).status, 403);
  assert.equal((await worker.fetch(new Request(valid.replace('9999999999', '1')))).status, 403);
});
test('forwards only signed path and range; strips cookies; never caches or follows redirects', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.origin, 'https://api.pxster.xyz');
    assert.equal(url.searchParams.has('target'), false);
    assert.equal(options.headers.has('Cookie'), false);
    assert.equal(options.headers.has('Authorization'), false);
    assert.equal(options.headers.get('Range'), 'bytes=0-9');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.cache, 'no-store');
    return new Response('0123456789', {status:206,headers:{'Content-Range':'bytes 0-9/50','Set-Cookie':'bad=value'}});
  });
  const response = await worker.fetch(new Request(valid+'&target=https://example.com',{headers:{Cookie:'session=private',Authorization:'Bearer private',Range:'bytes=0-9'}}));
  assert.equal(response.status,206);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(response.headers.has('Set-Cookie'),false);
  assert.equal(await response.text(),'0123456789');
});
test('preserves authorization failure and fails closed on redirects and network errors', async (t) => {
  const mock = t.mock.method(globalThis,'fetch',async()=>new Response('invalid',{status:403}));
  assert.equal((await worker.fetch(new Request(valid))).status,403);
  mock.mock.mockImplementation(async()=>new Response(null,{status:302,headers:{Location:'https://example.com'}}));
  assert.equal((await worker.fetch(new Request(valid))).status,502);
  mock.mock.mockImplementation(async()=>{throw new Error('unreachable');});
  assert.equal((await worker.fetch(new Request(valid))).status,502);
});
