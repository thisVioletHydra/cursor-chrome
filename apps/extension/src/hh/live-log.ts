import { ask } from './bridge';
import { browser } from '../browser-host';

const MAX_LINES = 12;

let shown: string[] = [];
let paints = 0;
let listening = false;

export function noteLive(line: string): Promise<void> {
  return ask({ type: 'page-log', line }).then(() => undefined);
}

export function mountLiveLog(): void {
  if (window !== window.top)
    return;

  listen();
  const seen = paints;
  void ask<{ lines?: unknown }>({ type: 'page-log-get' }).then((data) => {
    if (paints !== seen)
      return;

    const rows = rowsOf(data?.lines);
    if (rows.length === 0)
      return;

    paint(rows);
  });
}

export function keepLiveLog(): void {
  if (shown.length === 0)
    return;

  const host = document.getElementById('cc-hh-log');
  if (host === null) {
    paint(shown);

    return;
  }

  raise(host);
}

function listen(): void {
  if (listening)
    return;

  listening = true;
  browser.runtime.onMessage.addListener((message) => {
    const rows = logRows(message);
    if (rows === null || rows.length === 0)
      return;

    paint(rows);
  });
}

function logRows(message: unknown): string[] | null {
  if (typeof message !== 'object' || message === null)
    return null;

  if ('type' in message === false || message.type !== 'hh-log')
    return null;

  if ('lines' in message === false)
    return null;

  return rowsOf(message.lines);
}

function rowsOf(raw: unknown): string[] {
  if (Array.isArray(raw) === false)
    return [];

  return raw.filter((item): item is string => typeof item === 'string').slice(-MAX_LINES);
}

function paint(rows: string[]): void {
  paints += 1;
  shown = rows.slice(-MAX_LINES);
  if (shown.length === 0)
    return;

  const host = ensureHost();
  const list = host.shadowRoot?.querySelector('[data-cc-log]');
  if (list === null || list === undefined)
    return;

  list.replaceChildren();
  for (const line of shown) {
    const row = document.createElement('div');
    row.className = 'cc-line';
    row.textContent = line;
    list.append(row);
  }

  raise(host);
}

function ensureHost(): HTMLElement {
  paintCss();
  const existing = document.getElementById('cc-hh-log');
  if (existing)
    return existing;

  const host = document.createElement('div');
  host.id = 'cc-hh-log';
  host.setAttribute('popover', 'manual');
  host.style.cssText = 'position:fixed;inset:auto auto 12px 12px;margin:0;padding:0;border:0;background:transparent;width:220px;height:fit-content;overflow:visible;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { display: block; pointer-events: none; }
      .cc-log { width: 220px; max-height: 148px; overflow: hidden; background: #111; border: 1px solid #333; border-radius: 10px; padding: 6px 8px; box-shadow: 0 8px 24px #0008; font: 8px/1.35 ui-monospace, monospace; color: #eee; }
      .cc-line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    </style>
    <div class="cc-log" data-cc-log></div>
  `;
  document.documentElement.append(host);

  return host;
}

function paintCss(): void {
  if (document.getElementById('cc-hh-log-css'))
    return;

  const css = document.createElement('style');
  css.id = 'cc-hh-log-css';
  css.textContent = '#cc-hh-log,#cc-hh-log:popover-open{position:fixed;inset:auto auto 12px 12px;margin:0;border:0;padding:0;background:transparent;width:220px;height:fit-content;overflow:visible;pointer-events:none}#cc-hh-log::backdrop{display:none;pointer-events:none}';
  document.documentElement.append(css);
}

function raise(host: HTMLElement): void {
  try {
    if (host.matches(':popover-open') === false)
      host.showPopover();
  }
  catch {
  }
}
