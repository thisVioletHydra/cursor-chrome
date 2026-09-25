import type { ApplyPayload } from './bridge';

import { ask, localDay } from './bridge';
import { labeledApplies, paintApplyGroup } from './history-list';
import { pullRemoteNegotiations } from './negotiations';

type Overlay = {
  host: HTMLElement;
  shadow: ShadowRoot;
};

let overlay: Overlay | null = null;
let guarded = false;
let refreshing = false;
let paintKey = '';

export function mountOverlay(): void {
  paintOverlayCss();
  const stale = document.getElementById('cc-hh-overlay');
  if (stale && stale.shadowRoot?.querySelector('[data-cc-wait-n]') === null) {
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

    existing.setAttribute('popover', 'manual');

    guardPage();
    void refreshOverlay();

    return;
  }

  const host = document.createElement('div');
  host.id = 'cc-hh-overlay';
  host.setAttribute('popover', 'manual');
  host.style.cssText = 'position:fixed;inset:auto 12px 12px auto;margin:0;padding:0;border:0;background:transparent;width:220px;overflow:visible;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { display: block; }
      .cc-card { width: 220px; background: #111; border: 1px solid #333; border-radius: 10px; padding: 8px 10px; box-shadow: 0 8px 24px #0008; font: 12px/1.35 ui-sans-serif, system-ui, sans-serif; color: #eee; }
      button { width: 100%; margin: 0 0 6px; padding: 8px; border: 0; border-radius: 6px; background: #222; color: #eee; cursor: pointer; font: inherit; }
      .cc-today { margin: 0 0 4px; }
      .cc-flag { margin: 0 0 6px; color: #9ca3af; font-size: 11px; }
      .cc-list { max-height: 180px; overflow: auto; margin: 8px 0 0; }
      .cc-list[hidden] { display: none; }
      .cc-empty { margin: 0; color: #9ca3af; }
      a { color: #93c5fd; text-decoration: none; overflow-wrap: anywhere; }
      h4 { margin: 10px 0 4px; font-size: 11px; color: #9ca3af; letter-spacing: 0.03em; text-transform: uppercase; }
      ol { margin: 0 0 4px; padding: 0; list-style: none; }
      li { display: flex; gap: 0.4em; margin: 0 0 6px; color: #9ca3af; }
      li::before { content: counter(apply) "."; counter-increment: apply; flex: 0 0 2.25ch; text-align: right; font-variant-numeric: tabular-nums; }
      .cc-wait { margin: 6px 0 8px; padding: 6px 0 0; border-top: 1px solid #333; max-height: 140px; overflow: auto; }
      .cc-wait[hidden] { display: none; }
      .cc-wait h4 { color: #fbbf24; margin-top: 0; }
      .cc-wait a { color: #fde68a; }
      .cc-list h4:first-child { margin-top: 0; }
      [data-cc-wait-n] { color: #fbbf24; }
    </style>
    <div class="cc-card">
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
  if (overlay === null || refreshing)
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
  if (overlay === null)
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
  if (nextKey === paintKey)
    return;

  paintKey = nextKey;
  todayEl.textContent = String(data.today ?? 0);
  if (waitN)
    waitN.textContent = String(waiting.length);

  if (junkEl)
    junkEl.textContent = flags?.hideJunk === true ? 'мусор: вкл' : 'мусор: выкл';

  if (waitEl) {
    waitEl.replaceChildren();
    waitEl.hidden = waiting.length === 0;
    paintApplyGroup(waitEl, 'Ждут ответа', waiting, 1, { heading: 'h4' });
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
  if (document.getElementById('cc-hh-overlay-css'))
    return;

  const css = document.createElement('style');
  css.id = 'cc-hh-overlay-css';
  css.textContent = '#cc-hh-overlay,#cc-hh-overlay:popover-open{position:fixed;inset:auto 12px 12px auto;margin:0;border:0;padding:0;background:transparent;width:220px;height:fit-content;overflow:visible}#cc-hh-overlay::backdrop{display:none;pointer-events:none}';
  document.documentElement.append(css);
}

function rowKey(item: HistoryRow): string {
  return `${item.vacancyId}|${item.title}|${item.company}|${item.hints?.[0] || ''}|${item.sentAt}`;
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
  const open = host.hidden === false && host.matches(':popover-open');
  if (visible === open)
    return false;

  if (visible) {
    host.hidden = false;
    raiseOverlay(host);

    return true;
  }

  host.hidden = true;
  try {
    if (host.matches(':popover-open'))
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

function handleOverlayClick(event: Event): void {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLButtonElement && node.hasAttribute('data-cc-history')) {
      void toggleOverlayHistory();

      return;
    }

    if (node instanceof HTMLAnchorElement && node.href.length > 0) {
      window.open(node.href, '_blank', 'noopener');

      return;
    }
  }
}

