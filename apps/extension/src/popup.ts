const btn = document.getElementById('reconnect') as HTMLButtonElement | null;
const statusEl = document.getElementById('status');
const detailEl = document.getElementById('detail');
const verEl = document.getElementById('ver');
const tabEl = document.getElementById('tab');
const framesEl = document.getElementById('frames');

if (verEl)
  verEl.textContent = chrome.runtime.getManifest().version;

btn?.addEventListener('click', () => {
  void reconnect();
});

tabEl?.addEventListener('click', () => {
  const url = tabEl.dataset.url;
  if (!url)
    return;
  void navigator.clipboard.writeText(url).then(() => {
    tabEl.classList.add('copied');
    setTimeout(() => tabEl.classList.remove('copied'), 800);
  }).catch(() => {});
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
  await refreshPage();
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

async function refreshPage(): Promise<void> {
  if (!tabEl || !framesEl)
    return;
  try {
    const page = await chrome.runtime.sendMessage({ type: 'get-page' }) as {
      url?: string;
      frames?: number;
      error?: string;
    };
    const url = page?.url || '';
    tabEl.dataset.url = url;
    tabEl.textContent = shortUrl(url) || 'нет вкладки';
    const n = page?.frames ?? 0;
    framesEl.textContent = n > 1 ? `${n} frames` : n === 1 ? '1 frame' : '';
  }
  catch {
    tabEl.textContent = '';
    framesEl.textContent = '';
  }
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, '');
    const text = `${parsed.host}${path}`;
    return text.length > 48 ? `${text.slice(0, 45)}…` : text;
  }
  catch {
    return url.length > 48 ? `${url.slice(0, 45)}…` : url;
  }
}

void refresh();
void refreshPage();
setInterval(() => void refresh(), 1000);
setInterval(() => void refreshPage(), 3000);
