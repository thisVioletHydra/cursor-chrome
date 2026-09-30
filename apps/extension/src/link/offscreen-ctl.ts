import { getSyncKey, getSyncUrl, todayCount } from '../diary/apply-log';
import { browser } from '../browser-host';

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

export async function setBadge(on: boolean): Promise<void> {
  if (on === false) {
    await browser.action.setBadgeText({ text: 'OFF' });
    await browser.action.setBadgeBackgroundColor({ color: '#c00' });
    await browser.action.setBadgeTextColor({ color: '#fff' });

    return;
  }

  await browser.action.setBadgeText({ text: String(await todayCount()) });
  await browser.action.setBadgeBackgroundColor({ color: '#111' });
  await browser.action.setBadgeTextColor({ color: '#fff' });
}
