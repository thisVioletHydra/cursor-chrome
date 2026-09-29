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
const pinNote = document.getElementById('pin-note');
const urlNote = document.getElementById('url-note');
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

function showNote(node: HTMLElement | null, text: string, ok?: boolean): void {
  if (node === null)
    return;

  node.hidden = text.length === 0;
  node.className = ok === true ? 'power-note ok' : 'power-note';
  node.textContent = text;
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

      workerLine.textContent = `Запинена: ${title}`;
    }
    else {
      workerLine.textContent = 'Вкладка не запинена';
    }
  }

  if (pinNote) {
    pinNote.className = 'pin-note';
    pinNote.hidden = block === null;
    pinNote.textContent = block ?? '';
  }

  if (pinBtn === null)
    return;

  if (block) {
    pinBtn.hidden = false;
    pinBtn.disabled = true;
    pinBtn.textContent = 'Запинить';

    return;
  }

  if (alreadyWorker) {
    pinBtn.hidden = true;

    return;
  }

  pinBtn.hidden = false;
  pinBtn.disabled = false;
  pinBtn.textContent = check?.ok === true ? 'Сменить' : 'Запинить';
}

export async function pinHere(): Promise<void> {
  if (pinBtn?.disabled === true)
    return;

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (typeof tab?.id !== 'number') {
    await refreshWorkerPanel();
    showNote(pinNote, 'нет вкладки', false);

    return;
  }

  const url = tab.url || tab.pendingUrl || '';
  const block = pinBlockReason(url);
  if (block) {
    await refreshWorkerPanel();
    showNote(pinNote, block, false);

    return;
  }

  if (pinBtn) {
    pinBtn.disabled = true;
    pinBtn.textContent = 'Запинил…';
  }

  try {
    const result = await browser.runtime.sendMessage({ type: 'pin-tab', tabId: tab.id }) as WorkerSnap;
    await refreshWorkerPanel();
    if (result?.ok === true) {
      showNote(pinNote, 'Запинил', true);

      return;
    }

    showNote(pinNote, result?.reason || result?.error || 'не вышло', false);
  }
  catch (error) {
    await refreshWorkerPanel();
    showNote(pinNote, error instanceof Error ? error.message : 'не вышло', false);
  }
}

export async function openWorkerUrl(): Promise<void> {
  const href = parseHttpUrl(workerUrlEl?.value || '');
  if (href === null) {
    showNote(urlNote, 'нужен http(s)', false);

    return;
  }

  const openBtn = document.getElementById('open-worker-url');
  if (openBtn instanceof HTMLButtonElement) {
    openBtn.disabled = true;
    openBtn.textContent = 'Открываю…';
  }

  try {
    const result = await browser.runtime.sendMessage({ type: 'open-worker-url', url: href }) as WorkerSnap;
    await refreshWorkerPanel();
    if (result?.ok === true) {
      showNote(urlNote, result.status || 'Открыл и запинил', true);
      if (workerUrlEl)
        workerUrlEl.value = '';

      return;
    }

    if (result?.status === 'Уже открыта') {
      showNote(urlNote, 'Уже открыта', true);

      return;
    }

    showNote(urlNote, result?.reason || result?.error || 'не вышло', false);
  }
  catch (error) {
    showNote(urlNote, error instanceof Error ? error.message : 'не вышло', false);
  }
  finally {
    if (openBtn instanceof HTMLButtonElement) {
      openBtn.disabled = false;
      openBtn.textContent = 'Открыть';
    }
  }
}
