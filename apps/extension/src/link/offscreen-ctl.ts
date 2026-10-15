import { getSyncKey, getSyncUrl, todayCount } from '../diary/apply-log';
import { browser } from '../browser-host';
import { gateOpen, gateText, readGate } from '../local/link-gate.ts';

// У offscreen нет storage. Адрес и ключ читает воркер и кладёт их в ping.
type LinkCreds = { origin: string; key: string };

export async function ensureOffscreen(): Promise<string | undefined> {
  const hasDocument = await browser.offscreen.hasDocument?.() ?? false;
  if (hasDocument === false) {
    try {
      await browser.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS'],
        justification: 'Keepalive port and optional WebSocket to the local Cursor MCP server',
      });
    }
    catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (text.includes('Only a single offscreen') === false)
        return text;
    }
  }

  await pingOffscreen();
}

export async function waitOffscreen(): Promise<void> {
  const creds = await readLinkCreds();
  const until = Date.now() + 1_000;
  while (Date.now() < until) {
    const ping = await pingOffscreen(creds);
    if (ping)
      return;

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  throw new Error('Offscreen document did not start');
}

async function pingOffscreen(creds?: LinkCreds): Promise<unknown> {
  const link = creds ?? await readLinkCreds();

  return browser.runtime.sendMessage({
    type: 'ping-offscreen',
    origin: link.origin,
    key: link.key,
  }).catch(() => null);
}

async function readLinkCreds(): Promise<LinkCreds> {
  if (browser.storage?.local === undefined)
    return { origin: '', key: '' };

  try {
    const origin = (await getSyncUrl()).trim();
    const key = (await getSyncKey()).trim();

    return { origin, key };
  }
  catch {
    return { origin: '', key: '' };
  }
}

// Same badge as last time → no repaint: repeated setBadge calls from reconnect loops made the icon flicker («яйцо»).
let lastBadge = '';

// someone else painted the badge (gate «!» in background-hooks): next setBadge must repaint
export function forgetBadge(): void {
  lastBadge = '';
}

async function paintBadge(text: string, color: string, title: string): Promise<void> {
  const key = `${text}|${color}|${title}`;
  if (key === lastBadge)
    return;
  lastBadge = key;
  await browser.action.setBadgeText({ text });
  await browser.action.setBadgeBackgroundColor({ color });
  await browser.action.setBadgeTextColor({ color: '#fff' });
  await browser.action.setTitle({ title }).catch(() => {});
}

export async function setBadge(on: boolean): Promise<void> {
  // gate «без синка — пауза» wins over OFF/counter: no link to the admin → «!» with the same hint
  const gate = await readGate({ get: keys => browser.storage.local.get(keys) as Promise<Record<string, unknown>>, set: async () => {} }).catch(() => null);
  if (gateOpen(gate) === false) {
    await paintBadge('!', '#b45309', gateText(gate));

    return;
  }

  if (on === false) {
    await paintBadge('OFF', '#c00', '');

    return;
  }

  await paintBadge(String(await todayCount()), '#111', '');
}
