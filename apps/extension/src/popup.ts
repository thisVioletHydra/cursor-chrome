import { labeledApplies, paintApplyGroup } from './hh/history-list';
import { openWorkerUrl, pinHere, refreshWorkerPanel } from './popup-pin';
import { browser } from './browser-host';

type ApplyRecord = {
  title: string;
  company: string;
  url: string;
  vacancyId: string;
  sentAt: number;
  status?: string;
  hints?: string[];
};

type GoodResult = {
  ok?: boolean;
  report?: string;
  error?: string;
};

type ViewName = 'main' | 'history' | 'settings';

const HH_LABEL = 'Поднять HH';

const verEl = document.getElementById('ver');
const mainBtn = document.getElementById('make-good') as HTMLButtonElement | null;
const mainLabel = mainBtn?.querySelector('.cta-label');
const pillEl = document.getElementById('pill');
const reportEl = document.getElementById('report');
const viewMain = document.getElementById('view-main');
const viewHistory = document.getElementById('view-history');
const viewSettings = document.getElementById('view-settings');
const goMain = document.getElementById('go-main');
const goHistory = document.getElementById('go-history');
const goSettings = document.getElementById('go-settings');
const todayEl = document.getElementById('today');
const historyEl = document.getElementById('history');
const panes: Record<ViewName, HTMLElement | null> = {
  main: viewMain,
  history: viewHistory,
  settings: viewSettings,
};
const navs: Record<ViewName, HTMLElement | null> = {
  main: goMain,
  history: goHistory,
  settings: goSettings,
};
const syncEl = document.getElementById('sync-url') as HTMLInputElement | null;
const hideJunkEl = document.getElementById('flag-hide-junk') as HTMLInputElement | null;
const keepSessionEl = document.getElementById('flag-keep-session') as HTMLInputElement | null;
const workerUrlForm = document.getElementById('worker-url-form') as HTMLFormElement | null;

if (verEl)
  verEl.textContent = browser.runtime.getManifest().version;

let linked = false;

const clicks: Record<string, () => void> = {
  'make-good': () => void (linked ? hangUp() : makeGood()),
  'pin-here': () => void pinHere(),
  'go-main': () => show('main'),
  'go-history': () => show('history'),
  'go-settings': () => show('settings'),
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
  void browser.runtime.sendMessage({ type: 'set-flags', hideJunk: hideJunkEl.checked === true });
});

keepSessionEl?.addEventListener('change', () => {
  void browser.runtime.sendMessage({ type: 'set-flags', keepSession: keepSessionEl.checked === true });
});

workerUrlForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  void openWorkerUrl();
});

function show(name: ViewName): void {
  for (const key of Object.keys(panes) as ViewName[]) {
    const pane = panes[key];
    if (pane)
      pane.hidden = key !== name;

    navs[key]?.classList.toggle('on', key === name);
  }

  syncTabChip();
  if (name === 'history')
    void renderHistory();

  if (name === 'main')
    void refreshWorkerPanel();
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
  mainLabel.textContent = on ? 'Отключить' : HH_LABEL;
}

async function hangUp(): Promise<void> {
  if (mainBtn === null)
    return;

  mainBtn.disabled = true;
  try {
    await browser.runtime.sendMessage({ type: 'hangup' });
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
  await refreshWorkerPanel();
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
    const result = await browser.runtime.sendMessage({ type: 'make-good' }) as GoodResult;
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
      'fix: reload unpacked и нажми Поднять HH',
    ].join('\n');
    paintCta(false);
  }

  mainBtn.disabled = false;
  await refreshWorkerPanel();
}

async function renderHistory(): Promise<void> {
  if (historyEl === null || todayEl === null)
    return;

  const data = await browser.runtime.sendMessage({ type: 'apply-history' }) as {
    log?: ApplyRecord[];
    today?: number;
    waiting?: ApplyRecord[];
  };
  todayEl.textContent = String(data?.today ?? 0);
  historyEl.replaceChildren();
  const waiting = labeledApplies(data?.waiting || []);
  const log = labeledApplies((data?.log || []).filter(item => item.status !== 'needsHuman'));
  const todayKey = localDay(Date.now());
  let n = paintApplyGroup(historyEl, 'Ждут ответа', waiting, 1, {
    kind: 'wait',
    empty: 'пока нет мутных — охота сама шлёт стандарт',
  });
  n = paintApplyGroup(historyEl, 'Сегодня', log.filter(item => localDay(item.sentAt) === todayKey), n);
  paintApplyGroup(historyEl, 'Ранее', log.filter(item => localDay(item.sentAt) !== todayKey), n);
}

async function saveSync(): Promise<void> {
  await browser.runtime.sendMessage({ type: 'set-sync-url', url: syncEl?.value || '' });
}

async function bootSettings(): Promise<void> {
  const flags = await browser.runtime.sendMessage({ type: 'get-flags' }) as {
    hideJunk?: boolean;
    keepSession?: boolean;
  };
  const boxes: Array<[HTMLInputElement | null, boolean]> = [
    [hideJunkEl, flags?.hideJunk === true],
    [keepSessionEl, flags?.keepSession === true],
  ];
  for (const [element, on] of boxes) {
    if (element)
      element.checked = on;
  }

  const sync = await browser.runtime.sendMessage({ type: 'get-sync-url' }) as { url?: string };
  if (syncEl)
    syncEl.value = sync?.url || '';

  const hist = await browser.runtime.sendMessage({ type: 'apply-history' }) as { today?: number };
  if (todayEl)
    todayEl.textContent = String(hist?.today ?? 0);

  const state = await browser.runtime.sendMessage({ type: 'get-status' }) as { connected?: boolean };
  const on = state?.connected === true;
  paintCta(on);
  if (on && pillEl) {
    pillEl.hidden = false;
    pillEl.className = 'status ok';
    pillEl.textContent = 'CONNECT';
  }

  await refreshWorkerPanel();
}

function localDay(ms: number): string {
  const date = new Date(ms);

  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

void bootSettings();
requestAnimationFrame(() => syncTabChip());
