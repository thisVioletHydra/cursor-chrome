type ApplyRecord = {
  title: string;
  company: string;
  url: string;
  vacancyId: string;
  sentAt: number;
};

type GoodResult = {
  ok?: boolean;
  report?: string;
  error?: string;
};

const verEl = document.getElementById('ver');
const mainBtn = document.getElementById('make-good') as HTMLButtonElement | null;
const mainLabel = mainBtn?.querySelector('.cta-label');
const pillEl = document.getElementById('pill');
const reportEl = document.getElementById('report');
const viewMain = document.getElementById('view-main');
const viewSettings = document.getElementById('view-settings');
const goMain = document.getElementById('go-main');
const goSettings = document.getElementById('go-settings');
const todayEl = document.getElementById('today');
const historyEl = document.getElementById('history');
const syncEl = document.getElementById('sync-url') as HTMLInputElement | null;
const hideJunkEl = document.getElementById('flag-hide-junk') as HTMLInputElement | null;

if (verEl)
  verEl.textContent = chrome.runtime.getManifest().version;

let linked = false;

const clicks: Record<string, () => void> = {
  'make-good': () => void (linked ? hangUp() : makeGood()),
  'go-main': () => show('main'),
  'go-settings': () => show('settings'),
  'history-btn': () => void toggleHistory(),
  'save-sync': () => void saveSync(),
};

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element))
    return;

  let node: Element | null = target;
  while (node) {
    if (node instanceof HTMLElement && clicks[node.id]) {
      clicks[node.id]();

      return;
    }

    node = node.parentElement;
  }
});

reportEl?.addEventListener('click', () => {
  const text = reportEl.textContent || '';
  if (text.length === 0)
    return;

  void navigator.clipboard.writeText(text).then(() => {
    reportEl.classList.add('copied');
    setTimeout(() => reportEl.classList.remove('copied'), 800);
  }).catch(() => {});
});

hideJunkEl?.addEventListener('change', () => {
  void chrome.runtime.sendMessage({ type: 'set-flags', hideJunk: hideJunkEl.checked === true });
});

function show(name: 'main' | 'settings'): void {
  const settings = name === 'settings';
  if (viewMain)
    viewMain.hidden = settings;

  if (viewSettings)
    viewSettings.hidden = settings === false;

  goMain?.classList.toggle('on', settings === false);
  goSettings?.classList.toggle('on', settings);
  syncTabChip();
}

function syncTabChip(): void {
  const tabs = document.getElementById('tabs');
  const active = document.querySelector('.nav.on');
  if (!(tabs instanceof HTMLElement) || !(active instanceof HTMLElement))
    return;

  const track = tabs.getBoundingClientRect();
  const chip = active.getBoundingClientRect();
  tabs.style.setProperty('--toggle-tab-checked-top', `${chip.top - track.top}px`);
  tabs.style.setProperty('--toggle-tab-checked-left', `${chip.left - track.left}px`);
  tabs.style.setProperty('--toggle-tab-checked-width', `${chip.width}px`);
  tabs.style.setProperty('--toggle-tab-checked-height', `${chip.height}px`);
  tabs.classList.add('ready');
}

function paintCta(on: boolean): void {
  linked = on;
  if (mainBtn === null || mainLabel === null)
    return;

  mainBtn.classList.toggle('stop', on);
  mainLabel.textContent = on ? 'Отключить' : 'Сделай хорошо';
}

async function hangUp(): Promise<void> {
  if (mainBtn === null)
    return;

  mainBtn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'hangup' });
  }
  catch {
  }

  paintCta(false);
  if (pillEl) {
    pillEl.hidden = false;
    pillEl.className = 'status';
    pillEl.textContent = 'OFF';
  }

  if (reportEl)
    reportEl.hidden = true;

  mainBtn.disabled = false;
}

async function makeGood(): Promise<void> {
  if (mainBtn === null)
    return;

  if (mainLabel === null || pillEl === null || reportEl === null)
    return;

  mainBtn.disabled = true;
  mainLabel.textContent = 'Работаю…';
  pillEl.hidden = true;
  reportEl.hidden = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'make-good' }) as GoodResult;
    const report = result?.report || result?.error || 'нет ответа от service worker';
    const ok = result?.ok === true;
    pillEl.hidden = false;
    pillEl.className = `status ${ok ? 'ok' : 'fail'}`;
    pillEl.textContent = ok ? 'CONNECT' : 'НЕ CONNECT';
    reportEl.hidden = false;
    reportEl.textContent = report;
    paintCta(ok);
  }
  catch (error) {
    pillEl.hidden = false;
    pillEl.className = 'status fail';
    pillEl.textContent = 'НЕ CONNECT';
    reportEl.hidden = false;
    reportEl.textContent = [
      'Cursor Chrome: FAIL',
      'step: host',
      'reason: service worker asleep',
      `detail: ${error instanceof Error ? error.message : String(error)}`,
      'fix: reload unpacked и нажми Сделай хорошо',
    ].join('\n');
    paintCta(false);
  }

  mainBtn.disabled = false;
}

async function toggleHistory(): Promise<void> {
  if (historyEl === null)
    return;

  const open = historyEl.hidden;
  historyEl.hidden = open === false;
  if (open)
    await renderHistory();
}

async function renderHistory(): Promise<void> {
  if (!historyEl || !todayEl)
    return;

  const data = await chrome.runtime.sendMessage({ type: 'apply-history' }) as {
    log?: ApplyRecord[];
    today?: number;
  };
  todayEl.textContent = String(data?.today ?? 0);
  const log = data?.log || [];
  const todayKey = localDay(Date.now());
  const fresh = log.filter(item => localDay(item.sentAt) === todayKey);
  const older = log.filter(item => localDay(item.sentAt) !== todayKey);
  historyEl.replaceChildren();
  appendGroup(historyEl, 'Сегодня', fresh);
  appendGroup(historyEl, 'Ранее', older);
}

function appendGroup(root: HTMLElement, label: string, items: ApplyRecord[]): void {
  if (items.length === 0)
    return;

  const heading = document.createElement('h3');
  heading.textContent = label;
  root.append(heading);
  for (const item of items) {
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    const who = item.company ? ` — ${item.company}` : '';
    link.textContent = `${item.title || item.vacancyId}${who}`;
    root.append(link);
  }
}

async function saveSync(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'set-sync-url', url: syncEl?.value || '' });
}

async function bootSettings(): Promise<void> {
  const flags = await chrome.runtime.sendMessage({ type: 'get-flags' }) as { hideJunk?: boolean };
  if (hideJunkEl)
    hideJunkEl.checked = flags?.hideJunk === true;

  const sync = await chrome.runtime.sendMessage({ type: 'get-sync-url' }) as { url?: string };
  if (syncEl)
    syncEl.value = sync?.url || '';

  const hist = await chrome.runtime.sendMessage({ type: 'apply-history' }) as { today?: number };
  if (todayEl)
    todayEl.textContent = String(hist?.today ?? 0);

  const state = await chrome.runtime.sendMessage({ type: 'get-status' }) as { connected?: boolean };
  const on = state?.connected === true;
  paintCta(on);
  if (on && pillEl) {
    pillEl.hidden = false;
    pillEl.className = 'status ok';
    pillEl.textContent = 'CONNECT';
  }
}

function localDay(ms: number): string {
  const date = new Date(ms);

  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

void bootSettings();
requestAnimationFrame(() => syncTabChip());
