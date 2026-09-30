import type { ApplyPayload } from './bridge';

import { ask, localDay } from './bridge';
import { labeledApplies, paintApplyGroup, readWaitingKey } from './history-list';
import { pullRemoteNegotiations } from './negotiations';

type Overlay = {
  host: HTMLElement;
  shadow: ShadowRoot;
};

const OVERLAY_Z = '2147483646';

let overlay: Overlay | null = null;
let guarded = false;
let refreshing = false;
let holdPaint = false;
let showWaitEmpty = false;
let paintKey = '';

export function mountOverlay(): void {
  paintOverlayCss();
  const stale = document.getElementById('cc-hh-overlay');
  const card = stale?.shadowRoot?.querySelector('[data-cc-card]');
  const fresh = card instanceof HTMLElement && card.dataset.ccCard === 'drop';
  if (stale && fresh === false) {
    stale.remove();
    overlay = null;
  }

  const existing = document.getElementById('cc-hh-overlay');
  if (existing) {
    if (overlay === null) {
      overlay = {
        host: existing,
        shadow: existing.shadowRoot || existing.attachShadow({ mode: 'open' }),
      };
    }

    if (existing.getAttribute('popover') !== 'manual')
      existing.setAttribute('popover', 'manual');

    keepOverlayZ(existing);
    guardPage();
    void refreshOverlay();

    return;
  }

  const host = document.createElement('div');
  host.id = 'cc-hh-overlay';
  host.setAttribute('popover', 'manual');
  host.style.cssText = `position:fixed;inset:auto 12px 12px auto;margin:0;padding:0;border:0;background:transparent;width:220px;overflow:visible;z-index:${OVERLAY_Z};`;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { display: block; }
      :host([data-cc-shut]) { display: none !important; }
      .cc-card { width: 220px; background: #111; border: 1px solid #333; border-radius: 10px; padding: 8px 10px; box-shadow: 0 8px 24px #0008; font: 12px/1.35 ui-sans-serif, system-ui, sans-serif; color: #eee; }
      button { width: 100%; margin: 0 0 6px; padding: 8px; border: 0; border-radius: 6px; background: #222; color: #eee; cursor: pointer; font: inherit; }
      button.cc-drop { width: auto; flex: 0 0 auto; margin: 0; padding: 0 4px; background: transparent; color: #9ca3af; font-size: 14px; line-height: 1; }
      button.cc-clear { width: auto; margin: 0 0 6px; padding: 0; background: transparent; color: #fbbf24; font-size: 11px; text-align: left; }
      button.cc-drop:hover, button.cc-clear:hover { color: #fff; }
      button.cc-drop:active, button.cc-clear:active { opacity: 0.6; }
      button.cc-drop:focus-visible, button.cc-clear:focus-visible { outline: 1px solid #fbbf24; outline-offset: 1px; }
      .cc-today { margin: 0 0 4px; }
      .cc-flag { margin: 0 0 6px; color: #9ca3af; font-size: 11px; }
      .cc-list { max-height: 180px; overflow: auto; margin: 8px 0 0; }
      .cc-list[hidden] { display: none; }
      .cc-empty { margin: 0; color: #9ca3af; }
      a { color: #93c5fd; text-decoration: none; overflow-wrap: anywhere; }
      h4 { margin: 10px 0 4px; font-size: 11px; color: #9ca3af; letter-spacing: 0.03em; text-transform: uppercase; }
      ol { margin: 0 0 4px; padding: 0; list-style: none; }
      li { display: flex; align-items: baseline; gap: 0.4em; margin: 0 0 6px; color: #9ca3af; }
      li a { flex: 1 1 auto; min-width: 0; }
      li::before { content: counter(apply) "."; counter-increment: apply; flex: 0 0 2.25ch; text-align: right; font-variant-numeric: tabular-nums; }
      .cc-wait { margin: 6px 0 8px; padding: 6px 0 0; border-top: 1px solid #333; max-height: 140px; overflow: auto; }
      .cc-wait[hidden] { display: none; }
      .cc-wait h4 { color: #fbbf24; margin-top: 0; }
      .cc-wait a { color: #fde68a; }
      .cc-list h4:first-child { margin-top: 0; }
      [data-cc-wait-n] { color: #fbbf24; }
    </style>
    <div class="cc-card" data-cc-card="drop">
      <p class="cc-today">Сегодня: <strong data-cc-today>0</strong> · Ждут: <strong data-cc-wait-n>0</strong></p>
      <button type="button" data-cc-history>История</button>
      <p class="cc-flag" data-cc-junk>мусор: выкл</p>
      <div class="cc-wait" data-cc-wait hidden></div>
      <div class="cc-list" data-cc-list hidden></div>
    </div>
  `;
  document.documentElement.append(host);
  overlay = { host, shadow };
  guardPage();
  void refreshOverlay();
}

export async function toggleOverlayHistory(): Promise<void> {
  if (overlay === null)
    return;

  const list = overlay.shadow.querySelector<HTMLElement>('[data-cc-list]');
  const btn = overlay.shadow.querySelector('[data-cc-history]');
  if (list === null)
    return;

  const open = list.hidden;
  list.hidden = open === false;

  if (btn)
    btn.textContent = list.hidden ? 'История' : 'Скрыть';

  if (open) {
    await pullRemoteNegotiations();
    await refreshOverlay();
  }
}

type HistoryRow = ApplyPayload & { sentAt: number; status?: string; hints?: string[] };

export async function refreshOverlay(): Promise<void> {
  if (overlay === null || refreshing || holdPaint)
    return;

  refreshing = true;
  try {
    await paintOverlay();
  }
  finally {
    refreshing = false;
  }
}

async function paintOverlay(): Promise<void> {
  if (overlay === null || holdPaint)
    return;

  const flags = await ask<{ hideJunk?: boolean; showPop?: boolean }>({ type: 'get-flags' });
  const status = await ask<{ connected?: boolean }>({ type: 'get-status' });
  if (status === null)
    return;

  const visible = status.connected === true && flags?.showPop !== false;
  const changed = setPopVisible(overlay.host, visible);
  if (changed)
    paintKey = '';

  if (visible === false)
    return;

  const root = overlay.shadow;
  const todayEl = root.querySelector('[data-cc-today]');
  const waitN = root.querySelector('[data-cc-wait-n]');
  const junkEl = root.querySelector('[data-cc-junk]');
  const waitEl = root.querySelector<HTMLElement>('[data-cc-wait]');
  const list = root.querySelector<HTMLElement>('[data-cc-list]');
  if (todayEl === null)
    return;

  const data = await ask<{ today?: number; log?: HistoryRow[]; waiting?: HistoryRow[] }>({ type: 'apply-history' });
  if (holdPaint)
    return;

  if (data === null) {
    todayEl.textContent = '?';
    if (waitN)
      waitN.textContent = '?';

    if (junkEl)
      junkEl.textContent = 'обнови вкладку HH';

    if (waitEl)
      waitEl.hidden = true;

    if (list !== null && list.hidden === false) {
      list.replaceChildren();
      const empty = document.createElement('p');
      empty.className = 'cc-empty';
      empty.textContent = 'Расширение перезалили — обнови hh.ru';
      list.append(empty);
    }

    return;
  }

  const waiting = labeledApplies(data.waiting || []);
  const log = labeledApplies((data.log || []).filter(item => item.status !== 'needsHuman'));
  const listOpen = list !== null && list.hidden === false;
  const nextKey = [
    data.today ?? 0,
    flags?.hideJunk === true,
    waiting.map(rowKey).join('\n'),
    listOpen ? log.map(rowKey).join('\n') : 'shut',
  ].join('\u0001');
  if (nextKey === paintKey || holdPaint)
    return;

  paintKey = nextKey;
  todayEl.textContent = String(data.today ?? 0);
  if (waitN)
    waitN.textContent = String(waiting.length);

  if (junkEl)
    junkEl.textContent = flags?.hideJunk === true ? 'мусор: вкл' : 'мусор: выкл';

  if (waitEl) {
    waitEl.replaceChildren();
    if (waiting.length === 0) {
      if (showWaitEmpty)
        paintWaitEmpty();
      else
        waitEl.hidden = true;
    }
    else {
      showWaitEmpty = false;
      waitEl.hidden = false;
      paintApplyGroup(waitEl, 'Ждут ответа', waiting, 1, { heading: 'h4', drop: true });
    }
  }

  if (list === null || list.hidden)
    return;

  const key = localDay(Date.now());
  const fresh = log.filter(item => localDay(item.sentAt) === key);
  const older = log.filter(item => localDay(item.sentAt) !== key);
  list.replaceChildren();
  let n = waiting.length + 1;
  n = paintApplyGroup(list, 'Сегодня', fresh, n, { heading: 'h4' });
  n = paintApplyGroup(list, 'Ранее', older, n, { heading: 'h4' });
  if (n > waiting.length + 1)
    return;

  const empty = document.createElement('p');
  empty.className = 'cc-empty';
  empty.textContent = 'пока пусто';
  list.append(empty);
}

function paintOverlayCss(): void {
  const text = `#cc-hh-overlay,#cc-hh-overlay:popover-open{position:fixed;inset:auto 12px 12px auto;margin:0;border:0;padding:0;background:transparent;width:220px;height:fit-content;overflow:visible;z-index:${OVERLAY_Z}}#cc-hh-overlay[data-cc-shut]{display:none !important;pointer-events:none}#cc-hh-overlay::backdrop{display:none;pointer-events:none}`;
  const found = document.getElementById('cc-hh-overlay-css');
  if (found instanceof HTMLStyleElement) {
    if (found.textContent === text)
      return;

    found.textContent = text;

    return;
  }

  const css = document.createElement('style');
  css.id = 'cc-hh-overlay-css';
  css.textContent = text;
  document.documentElement.append(css);
}

function rowKey(item: HistoryRow): string {
  return `${item.vacancyId}|${item.title}|${item.company}|${item.hints?.[0] || ''}|${item.sentAt}`;
}

function keepOverlayZ(host: HTMLElement): void {
  if (host.style.zIndex === OVERLAY_Z)
    return;

  host.style.zIndex = OVERLAY_Z;
}

function raiseOverlay(host: HTMLElement): void {
  try {
    if (host.matches(':popover-open') === false)
      host.showPopover();
  }
  catch {
  }
}

function setPopVisible(host: HTMLElement, visible: boolean): boolean {
  const shut = host.hasAttribute('data-cc-shut');
  const popped = host.matches(':popover-open');
  if (visible) {
    if (shut === false && host.hidden === false && popped)
      return false;

    if (shut)
      host.removeAttribute('data-cc-shut');

    if (host.hidden)
      host.hidden = false;

    raiseOverlay(host);

    return shut;
  }

  if (shut && popped === false)
    return false;

  // hidden на popover Хром снимает и роняет карточку из top layer, она остаётся под страницей.
  host.setAttribute('data-cc-shut', '');
  try {
    if (popped)
      host.hidePopover();
  }
  catch {
  }

  return true;
}

function guardPage(): void {
  if (guarded)
    return;

  guarded = true;
  const kinds = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'touchstart'] as const;
  for (const kind of kinds)
    window.addEventListener(kind, onPageEvent, true);
}

function onPageEvent(event: Event): void {
  if (ours(event) === false)
    return;

  event.stopPropagation();
  event.stopImmediatePropagation();
  if (event.type !== 'click')
    return;

  event.preventDefault();
  handleOverlayClick(event);
}

function ours(event: Event): boolean {
  if (overlay === null)
    return false;

  return event.composedPath().includes(overlay.host);
}

function paintWaitCount(count: number): void {
  const waitN = overlay?.shadow.querySelector('[data-cc-wait-n]');
  if (waitN)
    waitN.textContent = String(count);
}

function paintWaitEmpty(): void {
  showWaitEmpty = true;
  const waitEl = overlay?.shadow.querySelector<HTMLElement>('[data-cc-wait]');
  if (waitEl === null || waitEl === undefined)
    return;

  waitEl.hidden = false;
  waitEl.replaceChildren();
  const heading = document.createElement('h4');
  heading.textContent = 'Ждут ответа';
  const empty = document.createElement('p');
  empty.className = 'cc-empty';
  empty.textContent = 'пусто';
  waitEl.append(heading, empty);
}

async function settleWaitEdit(): Promise<void> {
  holdPaint = false;
  paintKey = '';
  const until = Date.now() + 2000;
  while (refreshing && Date.now() < until)
    await new Promise(resolve => setTimeout(resolve, 30));

  await refreshOverlay();
}

async function dropOverlayRow(button: HTMLButtonElement): Promise<void> {
  if (holdPaint || overlay === null)
    return;

  const row = button.closest('li');
  const waitEl = overlay.shadow.querySelector('[data-cc-wait]');
  const key = readWaitingKey(button);
  row?.remove();
  const left = waitEl?.querySelectorAll('li').length ?? 0;
  paintWaitCount(left);
  if (left === 0)
    paintWaitEmpty();

  holdPaint = true;
  try {
    await ask({ type: 'drop-waiting', ...key });
  }
  finally {
    await settleWaitEdit();
  }
}

async function clearOverlayWait(): Promise<void> {
  if (holdPaint || overlay === null)
    return;

  paintWaitCount(0);
  paintWaitEmpty();
  holdPaint = true;
  try {
    await ask({ type: 'clear-waiting' });
  }
  finally {
    await settleWaitEdit();
  }
}

function handleOverlayClick(event: Event): void {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLButtonElement && node.hasAttribute('data-cc-history')) {
      void toggleOverlayHistory();

      return;
    }

    if (node instanceof HTMLButtonElement && node.hasAttribute('data-cc-drop')) {
      void dropOverlayRow(node);

      return;
    }

    if (node instanceof HTMLButtonElement && node.hasAttribute('data-cc-clear-wait')) {
      void clearOverlayWait();

      return;
    }

    if (node instanceof HTMLAnchorElement && node.href.length > 0) {
      node.style.color = '#86efac';
      void ask({ type: 'hh-same-tab', url: node.href });

      return;
    }
  }
}

