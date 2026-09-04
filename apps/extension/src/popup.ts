document.getElementById('reconnect')?.addEventListener('click', () => {
  void chrome.runtime.sendMessage({ type: 'reconnect' });
});

async function refresh(): Promise<void> {
  const statusEl = document.getElementById('status');
  const detailEl = document.getElementById('detail');
  if (!statusEl || !detailEl)
    return;
  const state = await chrome.runtime.sendMessage({ type: 'get-status' }) as {
    connected?: boolean;
    detail?: string;
  };
  const on = Boolean(state?.connected);
  statusEl.textContent = on ? 'ON' : 'OFF';
  statusEl.className = on ? 'on' : 'off';
  detailEl.textContent = state?.detail || (on ? 'ws://127.0.0.1:18765' : 'waiting for MCP');
}

void refresh();
setInterval(() => void refresh(), 1000);
