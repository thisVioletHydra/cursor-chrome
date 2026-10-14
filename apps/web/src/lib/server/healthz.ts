// GET /healthz: Railway healthcheck + ping target for the «updating» page/overlay/extension.
// Cheap (no DB, no auth, no tenant), never cached.
export const HEALTHZ = '/healthz';

export function isHealthz(pathname: string): boolean {
  return pathname === HEALTHZ;
}

export function healthz(): Response {
  return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
