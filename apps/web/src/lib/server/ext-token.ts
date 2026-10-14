// POST /admin/ext-token: hands the session's extToken to the admin page on an explicit click only.
// Never in load data/HTML. Read-only: never issues or rotates a token. Same-origin only, no-store.
export type ExtTokenDeps = {
  readSession: (raw: string | undefined) => { login: string } | null;
  allowed: (login: string) => boolean;
  isCreator: (login: string) => boolean;
  tokenOf: (login: string) => Promise<string>;
};

const NO_STORE = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'pragma': 'no-cache' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: NO_STORE });

export async function extTokenResponse(request: Request, cookie: (name: string) => string | undefined, deps: ExtTokenDeps): Promise<Response> {
  if (request.method !== 'POST')
    return reply(405, { error: 'method' });
  const origin = request.headers.get('origin');
  if (origin === null || origin !== new URL(request.url).origin)
    return reply(403, { error: 'origin' });
  const session = deps.readSession(cookie('session'));
  if (session === null || deps.allowed(session.login) === false)
    return reply(401, { error: 'нет' });
  if (deps.isCreator(session.login) && cookie('preview') === 'guest')
    return reply(403, { error: 'preview' });
  const token = await deps.tokenOf(session.login);
  return reply(200, { token });
}
