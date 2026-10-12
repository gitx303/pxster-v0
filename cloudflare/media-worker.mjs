// Signature verification remains in FastAPI; R2 is never public.
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { ...headers, Allow: 'GET' } });
    if (!/^\/media-delivery\/[a-f0-9-]{32,36}$/.test(url.pathname)) return new Response('Not found', { status: 404, headers });
    const expires = url.searchParams.get('expires');
    const signature = url.searchParams.get('signature');
    if (!/^\d{1,12}$/.test(expires || '') || Number(expires) < Date.now() / 1000 || !/^[a-f0-9]{64}$/.test(signature || '')) {
      return new Response('Media link expired or invalid', { status: 403, headers });
    }
    const target = new URL(url.pathname, 'https://api.pxster.xyz');
    target.searchParams.set('expires', expires);
    target.searchParams.set('signature', signature);
    const upstreamHeaders = new Headers();
    if (request.headers.has('Range')) upstreamHeaders.set('Range', request.headers.get('Range'));
    try {
      // Never forward cookies, authorization headers, arbitrary destinations, or redirects.
      const result = await fetch(target, { headers: upstreamHeaders, redirect: 'manual', cache: 'no-store' });
      if (![200, 206, 403, 404, 416, 422].includes(result.status)) {
        await result.body?.cancel();
        return new Response('Media delivery unavailable', { status: 502, headers });
      }
      const output = new Headers(headers);
      for (const name of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
        if (result.headers.has(name)) output.set(name, result.headers.get(name));
      }
      return new Response(result.body, { status: result.status, headers: output });
    } catch {
      return new Response('Media delivery unavailable', { status: 502, headers });
    }
  }
};
