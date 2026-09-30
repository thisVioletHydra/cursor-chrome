import { PILOT_LINK_KEY, readPilotLink, SERVER_SILENT, SERVER_WAIT } from './chrome/pilot-link';
import { WORKER_KEY } from './chrome/worker-tab';
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

const QUEUE_LABEL = 'Откликнуться сейчас';
const CLOSE_TAB = 'Закрыть запиненную вкладку';
const RAISE_HH = 'Поднять HH';

window.addEventListener('pagehide', () => {
  void browser.runtime.sendMessage({ type: 'pilot-touch', action: 'popup' });
});

const verEl = document.getElementById('ver');
const mainBtn = document.getElementById('make-good') as HTMLButtonElement | null;
const powerBtn = document.getElementById('power') as HTMLButtonElement | null;
const powerNoteEl = document.getElementById('power-note');
const linkNoteEl = document.getElementById('link-note');
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
const connectSaveEl = document.getElementById('connect-save') as HTMLButtonElement | null;
const connectErrorEl = document.getElementById('connect-error') as HTMLElement | null;
const hideJunkEl = document.getElementById('flag-hide-junk') as HTMLInputElement | null;
const showPopEl = document.getElementById('flag-show-pop') as HTMLInputElement | null;
const keepSessionEl = document.getElementById('flag-keep-session') as HTMLInputElement | null;
const workerUrlForm = document.getElementById('worker-url-form') as HTMLFormElement | null;

if (verEl)
  verEl.textContent = browser.runtime.getManifest().version;

let linked = false;
let adminOn = false;
let autoOn = false;
let powering = false;
let reviving = false;
let revivedAt = 0;
let clingUntil = 0;
let powerFail = '';
let waitCleared = false;

const clicks: Record<string, () => void> = {
  'make-good': () => void (linked ? hangUp() : makeGood()),
  'power': () => void togglePower(),
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

    return;
  }

  const link = target.closest('a');
  if (link instanceof HTMLAnchorElement && link.href.length > 0) {
    event.preventDefault();
    link.dataset.ccOpened = '1';
    void browser.runtime.sendMessage({ type: 'hh-same-tab', url: link.href });
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
  if (area !== 'local')
    return;

  const linkChange = changes[PILOT_LINK_KEY];
  if (linkChange !== undefined && autoOn)
    paintPilotLink(linkChange.newValue);

  if (changes[WORKER_KEY] !== undefined)
    void refreshWorkerPanel();

  if (changes.flags === undefined)
    return;

  const next = changes.flags.newValue;
  if (typeof next !== 'object' || next === null || !('autoQueue' in next))
    return;

  const on = next.autoQueue === true;
  if (on === false && (powering || Date.now() < clingUntil))
    return;

  if (on === autoOn)
    return;

  autoOn = on;
  paintPower();
  if (powering)
    return;

  if (on === false)
    paintOff();
  else
    void paintBootStatus();
});

browser.runtime.onMessage.addListener((message) => {
  if (typeof message !== 'object' || message === null)
    return;

  const type = 'type' in message ? message.type : '';
  if (type === 'queue-soon') {
    if (Date.now() - revivedAt < 45_000)
      return;

    paintStatus('Поиск начнётся примерно через полминуты');
  }
  else if (type === 'queue-busy')
    paintStatus('Читаю вакансии в запиненной вкладке hh');
  else if (type === 'queue-report' && 'run' in message)
    void paintQueue(message.run);
  else if (type === 'hang-status')
    void paintHang(message);
  else if (type === 'hang-clear')
    clearHangLabel();
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

  if (name === 'main') {
    void refreshWorkerPanel();
    void paintBootStatus();
  }
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
  if (mainBtn === null)
    return;

  mainBtn.textContent = on ? CLOSE_TAB : RAISE_HH;
}

function paintLink(text: string, ok: boolean): void {
  if (linkNoteEl === null)
    return;

  linkNoteEl.hidden = false;
  linkNoteEl.className = ok ? 'power-note ok' : 'power-note';
  linkNoteEl.textContent = text;
}

async function hangUp(): Promise<void> {
  if (mainBtn === null)
    return;

  mainBtn.disabled = true;
  mainBtn.textContent = 'Закрываю…';
  let failed = '';
  try {
    await browser.runtime.sendMessage({ type: 'hangup' });
  }
  catch (error) {
    failed = error instanceof Error ? error.message : 'не вышло';
  }

  const state = await browser.runtime.sendMessage({ type: 'get-status' }) as { connected?: boolean };
  paintCta(state?.connected === true);
  paintLink(failed.length > 0 ? failed : 'Вкладка закрыта, Cursor отключён', failed.length === 0);
  if (reportEl)
    reportEl.hidden = true;

  mainBtn.disabled = false;
  await refreshWorkerPanel();
}

async function makeGood(): Promise<void> {
  if (mainBtn === null || reportEl === null)
    return;

  mainBtn.disabled = true;
  mainBtn.textContent = 'Работаю…';
  reportEl.hidden = true;
  try {
    const result = await browser.runtime.sendMessage({ type: 'make-good' }) as GoodResult;
    const report = result?.report || result?.error || 'нет ответа от service worker';
    const ok = result?.ok === true;
    paintLink(ok ? 'Поднял HH' : 'Не вышло', ok);
    reportEl.hidden = false;
    reportEl.textContent = report;
    paintCta(ok);
  }
  catch (error) {
    paintLink('Не вышло', false);
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

type HhOpen = {
  ok?: boolean;
  reason?: string;
  error?: string;
  status?: string;
  url?: string;
};

function paintPilotLink(value: unknown): void {
  const text = typeof value === 'string' ? value : '';
  if (text.length > 0) {
    paintStatus(text, 'fail');
    paintPower();

    return;
  }

  if (powering)
    return;

  void paintBootStatus();
}

function paintStatus(text: string, kind: 'ok' | 'fail' | 'plain' = 'plain'): void {
  if (pillEl === null)
    return;

  pillEl.hidden = false;
  pillEl.className = kind === 'plain' ? 'status' : `status ${kind}`;
  pillEl.textContent = text;
}

function paintOff(): void {
  paintStatus('Выключено');
  void refreshWorkerPanel();
}

function pilotLine(text: string): string {
  if (text === SERVER_WAIT || text === SERVER_SILENT)
    return text;

  if (text.length > 0)
    return text;

  return SERVER_SILENT;
}

function isHang(reason: string): boolean {
  return reason === 'расширение зависло' || reason === 'я завис' || reason === 'сервер молчит' || reason.startsWith('замолчало');
}

function hangText(step: string): string {
  if (step.length === 0)
    return 'Зависло';

  return `Зависло на шаге «${step}»`;
}

function paintPower(): void {
  if (powerBtn === null)
    return;

  powerBtn.disabled = false;
  powerBtn.textContent = powerFail.length > 0 ? powerFail : (autoOn ? 'Выключить' : 'Включить');
  powerBtn.classList.toggle('on', autoOn && powerFail.length === 0);
  powerBtn.setAttribute('aria-pressed', autoOn ? 'true' : 'false');
}

function paintPowerNote(text: string): void {
  if (powerNoteEl === null)
    return;

  powerNoteEl.hidden = false;
  powerNoteEl.className = 'power-note';
  powerNoteEl.textContent = text;
}

function clearPowerNote(): void {
  if (powerNoteEl === null)
    return;

  powerNoteEl.hidden = true;
  powerNoteEl.textContent = '';
}

function clearHangLabel(): void {
  const text = pillEl?.textContent ?? '';
  if (text.startsWith('Зависло') === false)
    return;

  paintStatus(autoOn ? 'Включено' : 'Выключено', autoOn ? 'ok' : 'plain');
}

async function readStall(): Promise<string | null> {
  const data = await browser.runtime.sendMessage({ type: 'page-log-get' }) as { stall?: boolean; step?: string };
  if (data?.stall !== true)
    return null;

  return typeof data.step === 'string' ? data.step : '';
}

async function readPaused(): Promise<number | null> {
  const state = await browser.runtime.sendMessage({ type: 'get-paused' }) as { pausedUntil?: number | null };
  const until = typeof state?.pausedUntil === 'number' ? state.pausedUntil : 0;
  if (until > Date.now())
    return until;

  return null;
}

async function syncAuto(): Promise<void> {
  const flags = await browser.runtime.sendMessage({ type: 'get-flags' }) as { autoQueue?: boolean };
  autoOn = flags?.autoQueue === true;
  paintPower();
}

async function paintHang(message: unknown): Promise<void> {
  await syncAuto();
  if (autoOn === false) {
    paintOff();

    return;
  }

  const step = typeof message === 'object' && message !== null && 'step' in message && typeof message.step === 'string'
    ? message.step
    : '';
  paintStatus(hangText(step), 'fail');
}

async function paintQueue(run: QueueRun | unknown): Promise<void> {
  if (typeof run !== 'object' || run === null) {
    paintStatus('нет ответа', 'fail');

    return;
  }

  const row = run as QueueRun;
  const reason = row.error || row.reason || '';
  if (isHang(reason)) {
    await syncAuto();
    if (autoOn === false) {
      paintOff();

      return;
    }

    const step = await readStall();
    paintStatus(hangText(step ?? ''), 'fail');

    return;
  }

  if (reason === 'уже идёт') {
    paintStatus('Читаю вакансии в запиненной вкладке hh');

    return;
  }

  const applied = (row.sent ?? 0) + (row.human ?? 0) + (row.skipped ?? 0);
  if (applied === 0 && reason.length > 0)
    paintStatus(reason, 'fail');
  else if (row.ok === true || applied > 0)
    paintStatus(`Отправлено ${row.sent ?? 0} · ждут ${row.human ?? 0} · осталось ${row.left ?? 0}`, row.ok === true ? 'ok' : 'fail');
  else
    paintStatus(reason.length > 0 ? reason : 'НЕ ВЫШЛО', 'fail');
}

function isHhHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();

    return host === 'hh.ru' || host.endsWith('.hh.ru');
  }
  catch {
    return false;
  }
}

function openFail(opened: HhOpen): string {
  return opened.error || opened.reason || 'не удалось открыть hh';
}

async function ensureHh(): Promise<HhOpen> {
  const opened = await browser.runtime.sendMessage({ type: 'ensure-hh' }) as HhOpen;

  return opened ?? { ok: false, error: 'нет ответа' };
}

function kickSearch(): void {
  void browser.runtime.sendMessage({ type: 'run-queue' }).catch((error: unknown) => {
    paintStatus(error instanceof Error ? error.message : 'не вышло', 'fail');
  });
}

async function reviveHh(kick: boolean): Promise<void> {
  if (reviving || autoOn === false)
    return;

  reviving = true;
  try {
    const opened = await ensureHh();
    if (autoOn === false)
      return;

    if (opened.ok !== true) {
      const text = openFail(opened);
      paintStatus(text, 'fail');
      paintPowerNote(text);

      return;
    }

    revivedAt = Date.now();
    await refreshWorkerPanel();
    if (kick === false) {
      paintStatus('Читаю вакансии в запиненной вкладке hh');

      return;
    }

    paintStatus('Включено', 'ok');
    kickSearch();
  }
  catch (error) {
    const text = error instanceof Error ? error.message : 'не вышло';
    paintStatus(text, 'fail');
    paintPowerNote(text);
  }
  finally {
    reviving = false;
  }
}

async function paintBootStatus(): Promise<void> {
  await syncAuto();
  if (autoOn === false) {
    paintOff();
    await browser.runtime.sendMessage({ type: 'forget-hang' }).catch(() => {});

    return;
  }

  const link = await readPilotLink();
  if (link.length > 0) {
    paintStatus(pilotLine(link), 'fail');

    return;
  }

  if (powering)
    return;

  const step = await readStall();
  if (step !== null) {
    paintStatus(hangText(step), 'fail');

    return;
  }

  const paused = await readPaused();
  if (paused !== null) {
    paintStatus(`Пауза до ${clockOf(paused)}`);

    return;
  }

  const state = await browser.runtime.sendMessage({ type: 'get-queue-report' }) as {
    soon?: boolean;
    busy?: boolean;
    report?: QueueRun | null;
  };
  const check = await browser.runtime.sendMessage({ type: 'check-worker' }) as HhOpen;
  if (check?.ok !== true || isHhHost(check.url || '') === false) {
    paintStatus('Включено, но вкладки hh нет', 'fail');
    await reviveHh(state?.busy !== true);

    return;
  }

  if (state?.busy === true) {
    paintStatus('Читаю вакансии в запиненной вкладке hh');

    return;
  }

  const report = state?.report;
  const reportReason = report?.reason || '';
  const justKicked = reviving || Date.now() - revivedAt < 45_000;
  if (report && reportReason !== 'нет запиненной вкладки hh') {
    const applied = (report.sent ?? 0) + (report.human ?? 0) + (report.skipped ?? 0);
    if (reportReason.length > 0 || applied > 0)
      await paintQueue(report);
    else
      paintStatus('Включено', 'ok');

    return;
  }

  if (state?.soon === true && justKicked === false) {
    paintStatus('Поиск начнётся примерно через полминуты');

    return;
  }

  if (justKicked) {
    paintStatus('Включено', 'ok');

    return;
  }

  paintStatus('Включено, поиск не идёт', 'fail');
  revivedAt = Date.now();
  kickSearch();
}

async function togglePower(): Promise<void> {
  if (powerBtn === null || powerBtn.disabled)
    return;

  const next = autoOn === false;
  if (next && adminOn === false) {
    paintPowerNote('Сначала подключи админку в Настройках');

    return;
  }

  powering = true;
  powerFail = '';
  clingUntil = 0;
  powerBtn.disabled = true;
  powerBtn.textContent = next ? 'Включаю…' : 'Выключаю…';
  clearPowerNote();
  try {
    const result = await browser.runtime.sendMessage({ type: 'set-flags', autoQueue: next }) as { error?: string; autoQueue?: boolean };
    if (typeof result?.error === 'string' && result.error.length > 0 && result.autoQueue === true) {
      autoOn = true;
      paintStatus(pilotLine(result.error), 'fail');

      return;
    }

    if (typeof result?.error === 'string' && result.error.length > 0) {
      powerFail = result.error;
      autoOn = false;
      paintOff();

      return;
    }

    if (typeof result?.autoQueue !== 'boolean') {
      await syncAuto();
      const link = await readPilotLink();
      if (autoOn && link.length > 0) {
        paintStatus(pilotLine(link), 'fail');

        return;
      }

      powerFail = 'нет ответа';
      if (next)
        autoOn = false;

      return;
    }

    autoOn = result.autoQueue;
    paintPower();
    if (autoOn === false) {
      paintOff();

      return;
    }

    clingUntil = Date.now() + 15_000;
    const paused = await readPaused();
    if (paused !== null) {
      paintStatus(`Пауза до ${clockOf(paused)}`);

      return;
    }

    revivedAt = Date.now();
    paintStatus('Включено', 'ok');
    kickSearch();
  }
  catch (error) {
    const text = error instanceof Error ? error.message : 'не вышло';
    await syncAuto();
    const link = await readPilotLink();
    if (next && autoOn) {
      paintStatus(pilotLine(link), 'fail');

      return;
    }

    if (next) {
      powerFail = text;
      autoOn = false;
    }
    else {
      paintPowerNote(text);
    }
  }
  finally {
    powering = false;
    paintPower();
  }
}

async function runQueue(): Promise<void> {
  if (queueBtn === null)
    return;

  if (adminOn === false) {
    paintStatus('Сначала подключи админку в Настройках', 'fail');

    return;
  }

  queueBtn.disabled = true;
  queueBtn.textContent = 'Откликаюсь…';
  paintStatus('Откликаюсь…');
  let failed = '';
  try {
    const opened = await ensureHh();
    if (opened.ok !== true) {
      failed = openFail(opened);
      queueBtn.textContent = failed;
      paintStatus(failed, 'fail');

      return;
    }

    await refreshWorkerPanel();
    const run = await browser.runtime.sendMessage({ type: 'run-queue' }) as QueueRun;
    await paintQueue(run);
  }
  catch (error) {
    failed = error instanceof Error ? error.message : 'не вышло';
    queueBtn.textContent = failed;
    paintStatus(failed, 'fail');
  }
  finally {
    queueBtn.disabled = false;
    if (failed.length === 0)
      queueBtn.textContent = QUEUE_LABEL;
  }

  await renderHistory();
}

async function bootSettings(): Promise<void> {
  const flags = await browser.runtime.sendMessage({ type: 'get-flags' }) as {
    hideJunk?: boolean;
    keepSession?: boolean;
    showPop?: boolean;
    autoQueue?: boolean;
  };
  autoOn = flags?.autoQueue === true;
  const boxes: Array<[HTMLInputElement | null, boolean]> = [
    [hideJunkEl, flags?.hideJunk === true],
    [keepSessionEl, flags?.keepSession === true],
    [showPopEl, flags?.showPop !== false],
  ];
  for (const [element, on] of boxes) {
    if (element)
      element.checked = on;
  }

  await paintConnect();

  const hist = await browser.runtime.sendMessage({ type: 'apply-history' }) as { today?: number };
  if (todayEl)
    todayEl.textContent = String(hist?.today ?? 0);

  const state = await browser.runtime.sendMessage({ type: 'get-status' }) as { connected?: boolean };
  paintCta(state?.connected === true);
  await refreshWorkerPanel();
  await paintBootStatus();
}

function localDay(ms: number): string {
  const date = new Date(ms);

  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

void bootSettings().finally(() => {
  paintPower();
});
requestAnimationFrame(() => syncTabChip());
