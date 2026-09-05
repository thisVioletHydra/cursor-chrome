const btn = document.getElementById('reconnect') as HTMLButtonElement | null;
const statusEl = document.getElementById('status');
const detailEl = document.getElementById('detail');

btn?.addEventListener('click', () => {
  void reconnect();
});

async function reconnect(): Promise<void> {
  if (!btn || !detailEl)
    return;
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  detailEl.textContent = 'sending reconnect';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'reconnect' }) as {
      ok?: boolean;
      error?: string;
      detail?: string;
    };
    detailEl.textContent = result?.error || result?.detail || 'reconnect sent';
  }
  catch (error) {
    detailEl.textContent = error instanceof Error ? error.message : String(error);
  }
  btn.disabled = false;
  btn.textContent = 'Reconnect';
  await refresh();
}

async function refresh(): Promise<void> {
  if (!statusEl || !detailEl)
    return;
  try {
    const state = await chrome.runtime.sendMessage({ type: 'get-status' }) as {
      connected?: boolean;
      detail?: string;
      transport?: 'native' | 'offscreen' | 'none';
    };
    const on = Boolean(state?.connected);
    const transport = state?.transport || 'none';
    if (on && transport === 'native') {
      statusEl.textContent = 'NATIVE';
      statusEl.className = 'native';
    }
    else if (on) {
      statusEl.textContent = 'OFFSCREEN';
      statusEl.className = 'on';
    }
    else {
      statusEl.textContent = 'OFF';
      statusEl.className = 'off';
    }
    detailEl.textContent = state?.detail || (on ? 'ws://127.0.0.1:18765' : 'MCP not listening on :18765');
  }
  catch (error) {
    statusEl.textContent = 'OFF';
    statusEl.className = 'off';
    detailEl.textContent = error instanceof Error ? error.message : 'service worker asleep';
  }
}

void refresh();
setInterval(() => void refresh(), 1000);
