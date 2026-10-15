// HTTP logic for /api/ext/{next,report,config}; routes only pass the extToken→login resolver.
import { bus as defaultBus, LIMITS } from './cmd-bus.ts';
import { CONFIG, configBody } from './config.ts';

type LoginOf = (request: Request) => Promise<string | null>;
type Bus = typeof defaultBus;
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
const MAX_BODY = LIMITS.maxResultBytes + 4096;

type PlanHook = { onNext: (login: string, request: Request, waitMs?: number) => Promise<{ kind: 'off'; afterMs: number } | { kind: 'old' } | { kind: 'cmd'; cmd: unknown } | { kind: 'pause'; pause: unknown }> };

// plan: optional server planner (account flag). 'old' → plain bus poll as before; pause → 200 {type:'idle'|'stop'}.
export async function handleNext(request: Request, loginOf: LoginOf, bus: Bus = defaultBus, waitMs?: number, plan?: PlanHook): Promise<Response> {
  const login = await loginOf(request);
  if (login === null)
    return json({ error: 'нет' }, 401);
  if (plan) {
    const answer = await plan.onNext(login, request, waitMs);
    if (answer.kind === 'off')
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', 'x-next-after': String(answer.afterMs) } });
    if (answer.kind === 'pause')
      return json(answer.pause);
    if (answer.kind === 'cmd')
      return answer.cmd === null ? new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } }) : json(answer.cmd);
  }
  const cmd = await bus.next(login, request.signal, waitMs);
  return cmd === null ? new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } }) : json(cmd);
}

export async function handleReport(request: Request, loginOf: LoginOf, bus: Bus = defaultBus): Promise<Response> {
  const login = await loginOf(request);
  if (login === null)
    return json({ error: 'нет' }, 401);
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY)
    return json({ error: 'слишком большой отчёт' }, 413);
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY)
    return json({ error: 'слишком большой отчёт' }, 413);
  let body: unknown;
  try { body = JSON.parse(text); }
  catch { return json({ error: 'не JSON' }, 400); }
  const r = bus.report(login, body);
  if (r.status === 'ok')
    return json({ ok: true });
  return json({ error: r.error ?? 'команда не найдена' }, r.status === 'unknown' ? 404 : r.status === 'too_big' ? 413 : 400);
}

// settingsOf (stage D): per-account extension settings from the admin; null → extension keeps local values
export async function handleConfig(request: Request, loginOf: LoginOf, settingsOf?: (login: string) => unknown): Promise<Response> {
  const login = await loginOf(request);
  if (login === null)
    return json({ error: 'нет' }, 401);
  const { text, etag } = settingsOf ? configBody({ ...CONFIG, settings: settingsOf(login) ?? null }) : configBody();
  const headers = { etag, 'cache-control': 'no-cache', 'content-type': 'application/json' };
  if (request.headers.get('if-none-match') === etag)
    return new Response(null, { status: 304, headers });
  return new Response(text, { headers });
}

// POST /api/ext/config/seed: the extension hands over its local values once; ignored if the admin has any
export async function handleSeed(request: Request, loginOf: LoginOf, seed: (login: string, values: unknown) => boolean): Promise<Response> {
  const login = await loginOf(request);
  if (login === null)
    return json({ error: 'нет' }, 401);
  const text = await request.text();
  if (text.length > 4096)
    return json({ error: 'слишком большой' }, 413);
  let body: unknown;
  try { body = JSON.parse(text); }
  catch { return json({ error: 'не JSON' }, 400); }
  return json({ ok: true, seeded: seed(login, body) });
}
