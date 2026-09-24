import { todayCount } from './apply-log';
import { browser } from '../browser-host';

export async function ensureOffscreen(): Promise<string | undefined> {
  const hasDocument = await browser.offscreen.hasDocument?.() ?? false;
  if (hasDocument)
    return;

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

export async function waitOffscreen(): Promise<void> {
  const until = Date.now() + 1_000;
  while (Date.now() < until) {
    const ping = await browser.runtime.sendMessage({ type: 'ping-offscreen' }).catch(() => null);
    if (ping)
      return;

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  throw new Error('Offscreen document did not start');
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
