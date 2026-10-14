/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// Deploy window: navigations are network-first; on network error / 502 / 503 / 504 / ~8 s timeout we serve the
// cached self-contained /updating.html instead of Railway's error page. Only that one static file is cached:
// admin HTML and /api/** (user data) never go into the SW cache.
const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = 'nojob-updating-v1';
const PAGE = '/updating.html';
const TIMEOUT_MS = 8000;
const DOWN = new Set([502, 503, 504]);

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(new Request(new URL(PAGE, sw.location.origin), { cache: 'reload' }))).then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => sw.clients.claim()));
});

async function fallback(): Promise<Response> {
  const hit = await caches.match(PAGE);

  return hit ?? new Response('Обновляемся', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

async function navigate(request: Request): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(request, { signal: ctl.signal });

    return DOWN.has(res.status) ? fallback() : res;
  }
  catch {
    return fallback();
  }
  finally {
    clearTimeout(timer);
  }
}

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== sw.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/healthz')
    return; // straight to network, never cached
  if (request.mode === 'navigate')
    event.respondWith(navigate(request));
});
