export async function ensureOffscreen(): Promise<string | undefined> {
  const hasDocument = await chrome.offscreen.hasDocument?.() ?? false;
  if (hasDocument)
    return;

  try {
    await chrome.offscreen.createDocument({
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
  for (let index = 0; index < 20; index++) {
    const ping = await chrome.runtime.sendMessage({ type: 'ping-offscreen' }).catch(() => null);
    if (ping)
      return;

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  throw new Error('Offscreen document did not start');
}

export async function setBadge(on: boolean): Promise<void> {
  await chrome.action.setBadgeText({ text: on ? 'ON' : 'OFF' });
  await chrome.action.setBadgeBackgroundColor({ color: on ? '#0a0' : '#c00' });
}
