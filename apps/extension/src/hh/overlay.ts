import type { ApplyPayload } from './bridge';

import { ask, localDay } from './bridge';
import { pullRemoteNegotiations } from './negotiations';

type Overlay = {
  host: HTMLElement;
  shadow: ShadowRoot;
};

let overlay: Overlay | null = null;
let guarded = false;

export function mountOverlay(): void {
  paintOverlayCss();
  const existing = document.getElementById('cc-hh-overlay');
  if (existing) {
    if (overlay === null) {
      overlay = {
        host: existing,
        shadow: existing.shadowRoot || existing.attachShadow({ mode: 'open' }),
      };
    }

    existing.setAttribute('popover', 'manual');

    raiseOverlay(existing);
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
      button { width: 100%; margin: 0; padding: 8px; border: 0; border-radius: 6px; background: #222; color: #eee; cursor: pointer; font: inherit; }
      .cc-today { margin: 0 0 4px; }
      .cc-flag { margin: 0 0 6px; color: #9ca3af; font-size: 11px; }
      .cc-list { max-height: 180px; overflow: auto; margin: 8px 0 0; }
      .cc-list[hidden] { display: none; }
      .cc-empty { margin: 0; color: #9ca3af; }
      a { display: block; color: #93c5fd; text-decoration: none; margin: 0 0 4px; }
      h4 { margin: 6px 0 4px; font-size: 11px; color: #9ca3af; }
    </style>
    <div class="cc-card">
      <p class="cc-today">Сегодня: <strong data-cc-today>0</strong></p>
      <p class="cc-flag" data-cc-junk>мусор: выкл</p>
      <button type="button" data-cc-history>История</button>
      <div class="cc-list" data-cc-list hidden></div>
    </div>
  `;
  document.documentElement.append(host);
  raiseOverlay(host);
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

export async function refreshOverlay(): Promise<void> {
  if (overlay === null)
    return;

  raiseOverlay(overlay.host);

  const root = overlay.shadow;
  const todayEl = root.querySelector('[data-cc-today]');
  const junkEl = root.querySelector('[data-cc-junk]');
  const list = root.querySelector<HTMLElement>('[data-cc-list]');
  if (todayEl === null)
    return;

  const data = await ask<{ today?: number; log?: Array<ApplyPayload & { sentAt: number }> }>({ type: 'apply-history' });
  const flags = await ask<{ hideJunk?: boolean }>({ type: 'get-flags' });
  if (data === null) {
    todayEl.textContent = '?';

    if (junkEl)
      junkEl.textContent = 'обнови вкладку HH';

    if (list !== null && list.hidden === false) {
      list.replaceChildren();
      const empty = document.createElement('p');
      empty.className = 'cc-empty';
      empty.textContent = 'Расширение перезалили — обнови hh.ru';
      list.append(empty);
    }

    return;
  }

  todayEl.textContent = String(data.today ?? 0);

  if (junkEl)
    junkEl.textContent = flags?.hideJunk === true ? 'мусор: вкл' : 'мусор: выкл';

  if (list === null || list.hidden)
    return;

  const log = data.log || [];
  const key = localDay(Date.now());
  const fresh = log.filter(item => localDay(item.sentAt) === key);
  const older = log.filter(item => localDay(item.sentAt) !== key);
  list.replaceChildren();

  if (fresh.length === 0 && older.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'cc-empty';
    empty.textContent = 'пока пусто';
    list.append(empty);

    return;
  }

  paintGroup(list, 'Сегодня', fresh);
  paintGroup(list, 'Ранее', older);
}

function paintOverlayCss(): void {
  if (document.getElementById('cc-hh-overlay-css'))
    return;

  const css = document.createElement('style');
  css.id = 'cc-hh-overlay-css';
  css.textContent = '#cc-hh-overlay,#cc-hh-overlay:popover-open{position:fixed;inset:auto 12px 12px auto;margin:0;border:0;padding:0;background:transparent;width:220px;height:fit-content;overflow:visible}#cc-hh-overlay::backdrop{display:none;pointer-events:none}';
  document.documentElement.append(css);
}

function raiseOverlay(host: HTMLElement): void {
  try {
    if (host.matches(':popover-open') === false)
      host.showPopover();
  }
  catch {
  }
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

function paintGroup(
  root: HTMLElement,
  label: string,
  items: Array<{ title: string; company: string; url: string; vacancyId: string }>,
): void {
  if (items.length === 0)
    return;

  const heading = document.createElement('h4');
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
