// BYOK key check for the key wizard: GET /v1/models (is the key valid?), then a 1-token chat (are there credits?).
// The key lives only in this call: never logged, stored or echoed; provider error bodies are not passed through.
export const XAI_MODELS_URL = 'https://api.x.ai/v1/models';
export const XAI_CHAT_URL = 'https://api.x.ai/v1/chat/completions';
export const XAI_PROBE_MODEL = 'grok-4.7';
export const XAI_KEY_RE = /^xai-[A-Za-z0-9_-]{20,200}$/;

export type KeyCheck = { ok: boolean; code: 'ok' | 'bad-format' | 'bad-key' | 'no-credits' | 'key-no-credits' | 'network' | 'error'; message: string; status?: number };

export function validXaiKey(key: string): boolean {
  return XAI_KEY_RE.test(key.trim());
}

const CREDITS = /credit|billing|balance|quota|insufficient|payment|spending limit/i;

export function mapXaiStatus(status: number, body = ''): KeyCheck {
  if (status >= 200 && status < 300)
    return { ok: true, code: 'ok', message: '✅ ключ работает', status };
  if (status === 402 || status === 429 || CREDITS.test(body))
    return { ok: false, code: 'no-credits', message: 'нет кредитов / лимит', status };
  if (status === 401 || status === 403)
    return { ok: false, code: 'bad-key', message: 'неверный ключ', status };

  return { ok: false, code: 'error', message: `xAI ответил ${status}`, status };
}

export async function testXaiKey(key: string, fetcher: typeof fetch = fetch, timeoutMs = 10_000): Promise<KeyCheck> {
  const clean = key.trim();
  if (validXaiKey(clean) === false)
    return { ok: false, code: 'bad-format', message: 'не похоже на ключ xAI (xai-…)' };

  const auth = { authorization: `Bearer ${clean}` };
  let res: Response;
  try {
    res = await fetcher(XAI_MODELS_URL, { headers: auth, signal: AbortSignal.timeout(timeoutMs) });
  }
  catch {
    return { ok: false, code: 'network', message: 'нет связи' };
  }
  const body = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 2000);
  const listed = mapXaiStatus(res.status, body);
  if (listed.ok === false)
    return listed;

  // key is valid; a 1-token chat tells «no credits» apart (models listing works without credits)
  let chat: Response;
  try {
    chat = await fetcher(XAI_CHAT_URL, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ model: XAI_PROBE_MODEL, messages: [{ role: 'user', content: '1' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }
  catch {
    return { ok: false, code: 'network', message: 'нет связи' };
  }
  if (chat.ok)
    return listed;

  const chatBody = (await chat.text().catch(() => '')).slice(0, 2000);

  return mapChatStatus(chat.status, chatBody);
}

export function mapChatStatus(status: number, body = ''): KeyCheck {
  if (status === 402 || status === 403 || CREDITS.test(body))
    return { ok: false, code: 'key-no-credits', message: 'ключ верный, но нет кредитов', status };
  if (status === 429)
    return { ok: false, code: 'no-credits', message: 'нет кредитов / лимит', status };

  return { ok: false, code: 'error', message: `xAI ответил ${status}`, status };
}
