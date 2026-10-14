// NoJobNoProblemBuddy key wizard (xAI Grok). Opens the xAI console in a new tab on the user's click, reads the
// clipboard only on the user's click, validates the format, tests via our server (no host_permissions),
// saves into the existing AES-GCM BYOK store. No auto-clicks, no reading other pages.
export const XAI_KEYS_URL = 'https://console.x.ai/team/default/api-keys';
export const XAI_KEY_RE = /^xai-[A-Za-z0-9_-]{20,200}$/;

export const STEPS = [
  'Откроется консоль xAI. Войди, например через Google.',
  'Раздел API Keys → Create API key.',
  'Скопируй ключ целиком (xai-…) и вернись сюда.',
  'Нажми «Вставить из буфера», затем «Проверить».',
];

export type KeyCheck = { ok: boolean; code: string; message: string };

export function validXaiKey(key: string): boolean {
  return XAI_KEY_RE.test(key.trim());
}

export function maskKey(key: string): string {
  const text = key.trim();

  return text.length <= 10 ? '••••' : `${text.slice(0, 4)}${'•'.repeat(12)}${text.slice(-4)}`;
}

export async function readClipboardKey(clipboard: Pick<Clipboard, 'readText'> = navigator.clipboard): Promise<{ key: string; error: string }> {
  let text = '';
  try {
    text = (await clipboard.readText()).trim();
  }
  catch {
    return { key: '', error: 'нет доступа к буферу: вставь вручную (Cmd+V)' };
  }
  if (!text)
    return { key: '', error: 'буфер пуст' };
  if (validXaiKey(text) === false)
    return { key: '', error: 'в буфере не ключ xAI (ждём xai-…)' };

  return { key: text, error: '' };
}

export async function testKey(base: string, extToken: string, key: string, fetcher: typeof fetch = fetch): Promise<KeyCheck> {
  if (validXaiKey(key) === false)
    return { ok: false, code: 'bad-format', message: 'не похоже на ключ xAI (xai-…)' };
  if (!base)
    return { ok: false, code: 'network', message: 'админка не подключена' };

  try {
    const res = await fetcher(`${base}/api/byok/test`, { method: 'POST', headers: { 'x-llm-key': key, ...(extToken ? { authorization: `Bearer ${extToken}` } : {}) } });
    if (res.status === 401)
      return { ok: false, code: 'auth', message: 'расширение не привязано к админке' };
    const body = await res.json() as Partial<KeyCheck>;

    return { ok: body.ok === true, code: String(body.code ?? 'error'), message: String(body.message ?? `сервер ${res.status}`) };
  }
  catch {
    return { ok: false, code: 'network', message: 'нет связи' };
  }
}
