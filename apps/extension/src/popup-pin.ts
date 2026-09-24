import { browser } from './browser-host';

type WorkerSnap = {
  ok?: boolean;
  reason?: string;
  status?: string;
  url?: string;
  pinned?: boolean;
  tabId?: number;
  error?: string;
};

const BLOCKED_URL = /^(chrome|chrome-extension|edge|about|devtools|chrome-search|moz-extension):/i;
const TITLE_MAX = 40;

const pinBtn = document.getElementById('pin-here') as HTMLButtonElement | null;
const workerLine = document.getElementById('worker-line');
const workerHost = document.getElementById('worker-host');
const activeLine = document.getElementById('active-line');
const pinNote = document.getElementById('pin-note');
const pillEl = document.getElementById('pill');
const workerUrlEl = document.getElementById('worker-url') as HTMLInputElement | null;

function shortTitle(raw: string): string {
  const title = raw.trim() || 'без названия';
  if (title.length <= TITLE_MAX)
    return title;

  return `${title.slice(0, TITLE_MAX - 1)}…`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  }
  catch {
    return '';
  }
}

function pinBlockReason(url: string): string | null {
  if (url.length === 0)
    return 'нет URL вкладки';

  if (BLOCKED_URL.test(url))
    return 'сюда нельзя (служебная вкладка)';

  return null;
}

function showStatus(text: string, ok?: boolean): void {
  if (pillEl === null)
    return;

  pillEl.hidden = false;
  pillEl.className = ok === true ? 'status ok' : ok === false ? 'status fail' : 'status';
  pillEl.textContent = text;
}

function parseHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0)
    return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return null;

    return parsed.href;
  }
  catch {
    return null;
  }
}

export async function refreshWorkerPanel(): Promise<void> {
  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  const check = await browser.runtime.sendMessage({ type: 'check-worker' }) as WorkerSnap;
  const activeUrl = active?.url || active?.pendingUrl || '';
  const activeTitle = shortTitle(active?.title || activeUrl || 'вкладка');
  const block = pinBlockReason(activeUrl);
  const alreadyWorker = check?.ok === true
    && typeof check.tabId === 'number'
    && typeof active?.id === 'number'
    && check.tabId === active.id;

  if (workerLine) {
    if (check?.ok === true && check.url) {
      let title = shortTitle(hostOf(check.url) || 'вкладка');
      if (typeof check.tabId === 'number') {
        try {
          const tab = await browser.tabs.get(check.tabId);
          title = shortTitle(tab.title || check.url);
        }
        catch {
          title = shortTitle(check.url);
        }
      }

      workerLine.textContent = `Рабочая: ${title}`;
    }
    else {
      workerLine.textContent = 'Рабочей вкладки нет';
    }
  }

  if (workerHost) {
    const host = check?.ok === true && check.url ? hostOf(check.url) : '';
    workerHost.hidden = host.length === 0;
    workerHost.textContent = host;
  }

  if (activeLine)
    activeLine.textContent = `Сейчас открыта: ${activeTitle}`;

  if (pinNote) {
    pinNote.hidden = block === null;
    pinNote.textContent = block ?? '';
  }

  if (pinBtn === null)
    return;

  if (block) {
    pinBtn.disabled = true;
    pinBtn.textContent = 'Запинить эту';

    return;
  }

  if (alreadyWorker) {
    pinBtn.disabled = true;
    pinBtn.textContent = 'Уже рабочая';

    return;
  }

  pinBtn.disabled = false;
  pinBtn.textContent = `Запинить: ${activeTitle}`;
}

export async function pinHere(): Promise<void> {
  if (pinBtn?.disabled === true)
    return;

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (typeof tab?.id !== 'number') {
    showStatus('нет вкладки', false);
    await refreshWorkerPanel();

    return;
  }

  const url = tab.url || tab.pendingUrl || '';
  const block = pinBlockReason(url);
  if (block) {
    showStatus(block, false);
    await refreshWorkerPanel();

    return;
  }

  try {
    const result = await browser.runtime.sendMessage({ type: 'pin-tab', tabId: tab.id }) as WorkerSnap;
    if (result?.ok === true) {
      showStatus('Запинил эту', true);
      await refreshWorkerPanel();

      return;
    }

    showStatus(result?.reason || result?.error || 'не вышло', false);
  }
  catch (error) {
    showStatus(error instanceof Error ? error.message : 'не вышло', false);
  }

  await refreshWorkerPanel();
}

export async function openWorkerUrl(): Promise<void> {
  const href = parseHttpUrl(workerUrlEl?.value || '');
  if (href === null) {
    showStatus('нужен http(s)', false);

    return;
  }

  try {
    const result = await browser.runtime.sendMessage({ type: 'open-worker-url', url: href }) as WorkerSnap;
    if (result?.ok === true) {
      showStatus(result.status || 'Открыл и запинил', true);
      if (workerUrlEl)
        workerUrlEl.value = '';

      await refreshWorkerPanel();

      return;
    }

    if (result?.status === 'Уже открыта') {
      showStatus('Уже открыта', true);
      await refreshWorkerPanel();

      return;
    }

    showStatus(result?.reason || result?.error || 'не вышло', false);
  }
  catch (error) {
    showStatus(error instanceof Error ? error.message : 'не вышло', false);
  }

  await refreshWorkerPanel();
}
