// Dev switch for the server planner flag of the logged-in account (POST under session, same origin).
// Production: hidden and refused unless PLAN_FLAG_UI=1 is set explicitly. Default stays «off».
import type { PlanFlags } from './plan-flags.ts';

type Env = Record<string, string | undefined>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export function planFlagUi(env: Env): boolean {
  return env.PLAN_FLAG_UI === '1' || (env.RAILWAY_ENVIRONMENT === undefined && env.NODE_ENV !== 'production');
}

export type FlagDeps = { env: Env; flags: Pick<PlanFlags, 'enabled' | 'setEnabled'>; sessionLogin: () => string | null; guest: () => boolean };

export async function handlePlanFlag(request: Request, d: FlagDeps): Promise<Response> {
  if (planFlagUi(d.env) === false)
    return json({ error: 'нет' }, 404);
  const login = d.sessionLogin();
  if (login === null || d.guest())
    return json({ error: 'нет' }, 401);
  if (request.method === 'GET')
    return json({ login, enabled: d.flags.enabled(login) });
  if (request.method !== 'POST')
    return json({ error: 'method' }, 405);
  const origin = request.headers.get('origin');
  if (origin === null || origin !== new URL(request.url).origin)
    return json({ error: 'origin' }, 403);
  const body = await request.json().catch(() => null) as { on?: unknown } | null;
  const on = typeof body?.on === 'boolean' ? body.on : d.flags.enabled(login) === false;
  d.flags.setEnabled(login, on);

  return json({ login, enabled: d.flags.enabled(login) });
}
