import { labeledApplies, paintApplyGroup, readWaitingKey } from './hh/history-list';
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
const queueBtn = document.getElementById('run-queue') as HTMLButtonElement | null;
const connectForm = document.getElementById('connect-form') as HTMLFormElement | null;
const connectTitleEl = document.getElementById('connect-title');
const connectHostEl = document.getElementById('connect-host');
const connectNoteEl = document.getElementById('connect-note');
const connectLinkEl = document.getElementById('connect-link') as HTMLInputElement | null;
const connectSaveEl = document.getElementById('connect-save');
const connectErrorEl = document.getElementById('connect-error') as HTMLElement | null;
const hideJunkEl = document.getElementById('flag-hide-junk') as HTMLInputElement | null;
const showPopEl = document.getElementById('flag-show-pop') as HTMLInputElement | null;
const keepSessionEl = document.getElementById('flag-keep-session') as HTMLInputElement | null;
const autoQueueBox = document.getElementById('auto-queue') as HTMLElement | null;
const autoQueueEl = document.getElementById('flag-auto-queue') as HTMLInputElement | null;
const autoLineEl = document.getElementById('auto-line') as HTMLElement | null;
const workerUrlForm = document.getElementById('worker-url-form') as HTMLFormElement | null;

if (verEl)
  verEl.textContent = browser.runtime.getManifest().version;

let linked = false;
let adminOn = false;
let waitCleared = false;

const clicks: Record<string, () => void> = {
  'make-good': () => void (linked ? hangUp() : makeGood()),
  'pin-here': () => void pinHere(),
  'go-main': () => show('main'),
  'go-history': () => show('history'),
  'go-settings': () => show('settings'),
  'run-queue': () => void runQueue(),
};

historyEl?.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element))
    return;

  const drop = target.closest('[data-cc-drop]');
  if (drop instanceof HTMLButtonElement) {
    event.preventDefault();
    void dropHistoryRow(drop);

    return;
  }

  const clear = target.closest('[data-cc-clear-wait]');
  if (clear instanceof HTMLButtonElement) {
    event.preventDefault();
    void clearHistoryWait();
  }
});

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

showPopEl?.addEventListener('change', () => {
  void browser.runtime.sendMessage({ type: 'set-flags', showPop: showPopEl.checked === true });
});

keepSessionEl?.addEventListener('change', () => {
  void browser.runtime.sendMessage({ type: 'set-flags', keepSession: keepSessionEl.checked === true });
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || autoQueueEl === null || changes.flags === undefined)
    return;

  const next = changes.flags.newValue;
  if (typeof next !== 'object' || next === null || !('autoQueue' in next))
    return;

  autoQueueEl.checked = next.autoQueue === true;
  void paintAutoLine();
});

autoQueueEl?.addEventListener('change', () => {
  const on = autoQueueEl.checked === true;
  void browser.runtime.sendMessage({ type: 'set-flags', autoQueue: on })
    .then(async () => {
      await paintAutoLine();
      if (on === false)
        return;

      const state = await browser.runtime.sendMessage({ type: 'get-paused' }) as { pausedUntil?: number | null };
      const until = typeof state?.pausedUntil === 'number' ? state.pausedUntil : 0;
      if (until > Date.now())
        return;

      paintSearchWait('Поиск начнётся примерно через полминуты');
    });
});

browser.runtime.onMessage.addListener((message) => {
  if (typeof message !== 'object' || message === null)
    return;

  const type = 'type' in message ? message.type : '';
  if (type === 'queue-soon')
    paintSearchWait('Поиск начнётся примерно через полминуты');
  else if (type === 'queue-busy')
    paintSearchWait('Читаю вакансии в запиненной вкладке hh');
  else if (type === 'queue-report' && 'run' in message)
    paintQueue(message.run);
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
  if (waiting.length > 0)
    waitCleared = false;

  let n = paintApplyGroup(historyEl, 'Ждут ответа', waiting, 1, {
    kind: 'wait',
    drop: true,
    empty: waitCleared ? 'пусто' : 'пока нет мутных — охота сама шлёт стандарт',
  });
  n = paintApplyGroup(historyEl, 'Сегодня', log.filter(item => localDay(item.sentAt) === todayKey), n);
  paintApplyGroup(historyEl, 'Ранее', log.filter(item => localDay(item.sentAt) !== todayKey), n);
}

function paintHistoryWaitEmpty(): void {
  if (historyEl === null)
    return;

  waitCleared = true;
  historyEl.querySelector('.cc-clear')?.remove();
  const heading = historyEl.querySelector('h3.wait');
  const list = heading?.nextElementSibling;
  if (list instanceof HTMLOListElement)
    list.remove();

  if (historyEl.querySelector('.cc-empty-wait'))
    return;

  const empty = document.createElement('p');
  empty.className = 'empty cc-empty-wait';
  empty.textContent = 'пусто';
  heading?.after(empty);
}

async function dropHistoryRow(button: HTMLButtonElement): Promise<void> {
  const row = button.closest('li');
  const list = row?.parentElement;
  const key = readWaitingKey(button);
  button.disabled = true;
  row?.remove();
  const left = list?.querySelectorAll('li').length ?? 0;
  if (left === 0)
    paintHistoryWaitEmpty();

  try {
    await browser.runtime.sendMessage({ type: 'drop-waiting', ...key });
  }
  finally {
    await renderHistory();
  }
}

async function clearHistoryWait(): Promise<void> {
  const clear = historyEl?.querySelector<HTMLButtonElement>('.cc-clear');
  if (clear)
    clear.disabled = true;

  paintHistoryWaitEmpty();
  try {
    await browser.runtime.sendMessage({ type: 'clear-waiting' });
  }
  finally {
    await renderHistory();
  }
}

function parseConnectLink(raw: string): { url: string; key: string } | null {
  try {
    const link = new URL(raw.trim());
    const path = link.pathname.replace(/\/+$/, '');
    if (path !== '/connect')
      return null;

    const key = decodeURIComponent(link.hash.replace(/^#/, '')).trim();
    if (key.length < 16)
      return null;

    return { url: `${link.protocol}//${link.host}`, key };
  }
  catch {
    return null;
  }
}

function clearConnectAnswer(): void {
  connectSaveEl?.classList.remove('saved');
  if (connectSaveEl)
    connectSaveEl.textContent = adminOn ? 'Заменить' : 'Подключить';

  if (connectErrorEl === null)
    return;

  connectErrorEl.hidden = true;
  connectErrorEl.className = 'connect-error';
  connectErrorEl.textContent = '';
}

function paintConnectFail(text: string): void {
  clearConnectAnswer();
  if (connectErrorEl === null)
    return;

  connectErrorEl.hidden = false;
  connectErrorEl.textContent = text;
}

async function connectFromLink(): Promise<void> {
  if (connectLinkEl === null || connectErrorEl === null || connectSaveEl === null)
    return;

  const parsed = parseConnectLink(connectLinkEl.value);
  if (parsed === null) {
    paintConnectFail('Это не ссылка подключения');
    return;
  }

  connectSaveEl.disabled = true;
  connectSaveEl.classList.remove('saved');
  connectSaveEl.textContent = 'Сохраняю…';
  connectErrorEl.hidden = true;
  try {
    const result = await browser.runtime.sendMessage({
      type: 'set-sync-url',
      url: parsed.url,
      key: parsed.key,
    }) as { ok?: boolean; error?: string };
    if (result?.ok !== true) {
      paintConnectFail('Не сохранилось');
      return;
    }

    connectLinkEl.value = '';
    connectSaveEl.classList.add('saved');
    await paintConnect();
    connectSaveEl.textContent = 'Заменено';
    connectErrorEl.className = 'connect-error ok';
    connectErrorEl.hidden = false;
    connectErrorEl.textContent = 'Заменено';
  }
  catch {
    paintConnectFail('Не сохранилось');
  }
  finally {
    connectSaveEl.disabled = false;
  }
}

connectForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  void connectFromLink();
});

connectLinkEl?.addEventListener('input', () => {
  if (connectSaveEl?.classList.contains('saved') === true || connectErrorEl?.hidden === false)
    clearConnectAnswer();
});

async function paintConnect(): Promise<void> {
  const sync = await browser.runtime.sendMessage({ type: 'get-sync-url' }) as { url?: string; hasKey?: boolean };
  const url = sync?.url || '';
  const on = sync?.hasKey === true && url.length > 0;
  adminOn = on;
  if (queueBtn)
    queueBtn.hidden = on === false;

  if (autoQueueBox)
    autoQueueBox.hidden = on === false;

  if (connectTitleEl)
    connectTitleEl.textContent = on ? 'Админка' : 'Подключи админку';

  if (connectHostEl) {
    connectHostEl.hidden = on === false;
    connectHostEl.textContent = on ? hostOf(url) : '';
  }

  if (connectNoteEl)
    connectNoteEl.hidden = on;

  if (connectSaveEl && connectSaveEl.classList.contains('saved') === false)
    connectSaveEl.textContent = on ? 'Заменить' : 'Подключить';
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  }
  catch {
    return url;
  }
}

async function paintAutoLine(): Promise<void> {
  if (autoLineEl === null)
    return;

  const state = await browser.runtime.sendMessage({ type: 'get-paused' }) as { pausedUntil?: number | null };
  const until = typeof state?.pausedUntil === 'number' ? state.pausedUntil : 0;
  const paused = until > Date.now();
  autoLineEl.classList.toggle('paused', paused);
  autoLineEl.textContent = paused ? `Пауза до ${clockOf(until)}` : 'Каждые 15 мин, пока в очереди есть вакансии';
}

function clockOf(ms: number): string {
  const date = new Date(ms);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${hours}:${minutes}`;
}

type QueueRun = {
  ok?: boolean;
  sent?: number;
  human?: number;
  skipped?: number;
  left?: number;
  reason?: string;
  lines?: string[];
  error?: string;
};

function paintSearchWait(text: string): void {
  if (pillEl === null || reportEl === null)
    return;

  pillEl.hidden = false;
  pillEl.className = 'status';
  pillEl.textContent = 'Ищу';
  reportEl.hidden = false;
  reportEl.textContent = text;
}

function paintQueue(run: QueueRun | unknown): void {
  if (pillEl === null || reportEl === null || typeof run !== 'object' || run === null)
    return;

  const row = run as QueueRun;
  const reason = row.error || row.reason || '';
  const lines = [...(row.lines ?? [])];
  if (reason.length > 0 && lines.includes(reason) === false)
    lines.push(reason);

  const applied = (row.sent ?? 0) + (row.human ?? 0) + (row.skipped ?? 0);
  pillEl.hidden = false;
  if (applied === 0 && reason.length > 0) {
    pillEl.className = 'status fail';
    pillEl.textContent = reason;
  }
  else if (row.ok === true || applied > 0) {
    pillEl.className = `status ${row.ok === true ? 'ok' : 'fail'}`;
    pillEl.textContent = `Отправлено ${row.sent ?? 0} · ждут ${row.human ?? 0} · осталось ${row.left ?? 0}`;
  }
  else {
    pillEl.className = 'status fail';
    pillEl.textContent = reason.length > 0 ? reason : 'НЕ ВЫШЛО';
  }

  reportEl.hidden = lines.length === 0;
  reportEl.textContent = lines.join('\n');
}

async function paintStoredReport(): Promise<void> {
  const state = await browser.runtime.sendMessage({ type: 'get-queue-report' }) as {
    soon?: boolean;
    busy?: boolean;
    report?: QueueRun | null;
  };
  if (state?.busy === true) {
    paintSearchWait('Читаю вакансии в запиненной вкладке hh');

    return;
  }

  if (state?.soon === true) {
    paintSearchWait('Поиск начнётся примерно через полминуты');

    return;
  }

  if (state?.report)
    paintQueue(state.report);
}

async function runQueue(): Promise<void> {
  if (queueBtn === null || pillEl === null || reportEl === null)
    return;

  queueBtn.disabled = true;
  queueBtn.textContent = 'Откликаюсь…';
  pillEl.hidden = true;
  reportEl.hidden = true;
  try {
    const run = await browser.runtime.sendMessage({ type: 'run-queue' }) as QueueRun;
    paintQueue(run);
  }
  catch (error) {
    pillEl.hidden = false;
    pillEl.className = 'status fail';
    pillEl.textContent = 'НЕ ВЫШЛО';
    reportEl.hidden = false;
    reportEl.textContent = error instanceof Error ? error.message : String(error);
  }

  queueBtn.disabled = false;
  queueBtn.textContent = 'Разобрать очередь';
  await paintAutoLine();
  await renderHistory();
}

async function bootSettings(): Promise<void> {
  const flags = await browser.runtime.sendMessage({ type: 'get-flags' }) as {
    hideJunk?: boolean;
    keepSession?: boolean;
    showPop?: boolean;
    autoQueue?: boolean;
  };
  const boxes: Array<[HTMLInputElement | null, boolean]> = [
    [hideJunkEl, flags?.hideJunk === true],
    [keepSessionEl, flags?.keepSession === true],
    [showPopEl, flags?.showPop !== false],
    [autoQueueEl, flags?.autoQueue === true],
  ];
  for (const [element, on] of boxes) {
    if (element)
      element.checked = on;
  }

  await paintConnect();
  await paintAutoLine();

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
  await paintStoredReport();
}

function localDay(ms: number): string {
  const date = new Date(ms);

  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

void bootSettings();
requestAnimationFrame(() => syncTabChip());
