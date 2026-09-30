import { machineWanted, readSnap, statusLines } from './machine-read';
import { browser } from '../browser-host';

const HOST_ID = 'cc-hh-machine';
const Z = '2147483646';
const TICK_MS = 1000;
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>';
const BOX = `<style>:host{display:block;pointer-events:none}.cc-box{width:220px;background:#111;border:1px solid #333;border-radius:10px;padding:6px 8px;box-shadow:0 8px 24px #0008;font:12px/1.35 ui-sans-serif,system-ui,sans-serif;color:#eee}p{margin:0 0 2px;overflow-wrap:anywhere}.cc-bad{color:#fbbf24}.cc-copy{display:flex;align-items:center;gap:6px;width:100%;margin:6px 0 0;padding:4px 0 0;border:0;border-top:1px solid #333;background:transparent;color:#bbb;font:inherit;text-align:left;cursor:pointer;pointer-events:auto}.cc-copy:hover{color:#fff}.cc-copy svg{width:14px;height:14px;flex:none}.cc-note{min-width:0;overflow-wrap:anywhere}</style><div class="cc-box"><div data-cc-machine></div><button type="button" class="cc-copy" data-cc-copy aria-label="Скопировать">${COPY_ICON}<span class="cc-note" data-cc-copy-note></span></button></div>`;

let mounted = false;
let epoch = 0;
let timer: number | undefined;
let pulling = false;
let dirty = false;
let copyTimer: number | undefined;

export function mountMachine(): void {
  if (window !== window.top || mounted)
    return;

  mounted = true;
  paintCss();
  ensureHost();
  listen();
  void browser.storage.local.get('flags').then((stored) => {
    arm(machineWanted(stored));
  }).catch(() => {
    arm(false);
  });
}

export function keepMachine(): void {
  if (window !== window.top)
    return;

  paintCss();
  const found = document.getElementById(HOST_ID);
  if (found instanceof HTMLElement === false) {
    if (timer !== undefined)
      ensureHost();

    return;
  }

  keepZ(found);
  if (found.hasAttribute('data-cc-shut'))
    return;

  raise(found);
}

function listen(): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local')
      return;

    if (changes.flags !== undefined) {
      arm(machineWanted(changes.flags.newValue));

      return;
    }

    if (timer !== undefined && storedLive(changes))
      void pull(epoch);
  });
  browser.runtime.onMessage.addListener((message) => {
    if (timer !== undefined && liveType(message))
      void pull(epoch);
  });
  window.addEventListener('pagehide', () => {
    epoch += 1;
    stopTimer();
  });
}

function storedLive(changes: { [key: string]: chrome.storage.StorageChange }): boolean {
  return changes.pilotLink !== undefined || changes.queueBusy !== undefined || changes.queueReport !== undefined;
}

function liveType(message: unknown): boolean {
  const type = messageType(message);

  return type === 'hh-log'
    || type === 'hang-status'
    || type === 'hang-clear'
    || type === 'queue-busy'
    || type === 'queue-soon'
    || type === 'queue-report';
}

function messageType(message: unknown): unknown {
  if (typeof message !== 'object' || message === null || Object.hasOwn(message, 'type') === false)
    return undefined;

  for (const [name, value] of Object.entries(message)) {
    if (name === 'type')
      return value;
  }

  return undefined;
}

function arm(on: boolean): void {
  if (on === false) {
    epoch += 1;
    stopTimer();
    shut();

    return;
  }

  const gen = epoch;
  if (timer === undefined) {
    timer = window.setInterval(() => {
      void pull(gen);
    }, TICK_MS);
  }

  void pull(gen);
}

function stopTimer(): void {
  if (timer === undefined)
    return;

  window.clearInterval(timer);
  timer = undefined;
}

async function pull(gen: number): Promise<void> {
  if (pulling) {
    dirty = true;

    return;
  }

  pulling = true;
  try {
    do {
      dirty = false;
      const snap = await readSnap();
      if (gen !== epoch)
        return;

      if (snap === null || snap.show === false) {
        if (snap !== null)
          arm(false);

        return;
      }

      paint(ensureHost(), statusLines(snap));
    } while (dirty && gen === epoch);
  }
  finally {
    pulling = false;
  }
}

function paint(host: HTMLElement, lines: string[]): void {
  const body = host.shadowRoot?.querySelector('[data-cc-machine]');
  if (body === null || body === undefined)
    return;

  const next = lines.join('\n');
  if (body.getAttribute('data-cc-text') !== next || host.hasAttribute('data-cc-shut')) {
    body.setAttribute('data-cc-text', next);
    body.replaceChildren();
    for (const line of lines)
      body.append(rowEl(line));
  }

  open(host);
}

function rowEl(line: string): HTMLElement {
  const row = document.createElement('p');
  row.textContent = line;
  if (line.startsWith('я завис') || line === 'сервер молчит')
    row.className = 'cc-bad';

  return row;
}

function open(host: HTMLElement): void {
  keepZ(host);
  if (host.hasAttribute('data-cc-shut'))
    host.removeAttribute('data-cc-shut');

  raise(host);
}

// hidden на popover Хром снимает и роняет панель под страницу.
function shut(): void {
  const host = document.getElementById(HOST_ID);
  if (host instanceof HTMLElement === false)
    return;

  keepZ(host);
  if (host.hasAttribute('data-cc-shut') === false)
    host.setAttribute('data-cc-shut', '');

  try {
    if (host.matches(':popover-open'))
      host.hidePopover();
  }
  catch {
  }
}

function ensureHost(): HTMLElement {
  paintCss();
  const existing = document.getElementById(HOST_ID);
  if (existing instanceof HTMLElement) {
    keepZ(existing);
    fillHost(existing);

    return existing;
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('popover', 'manual');
  host.setAttribute('data-cc-shut', '');
  host.style.cssText = `position:fixed;inset:auto auto 12px 12px;margin:0;padding:0;border:0;background:transparent;width:220px;height:fit-content;overflow:visible;z-index:${Z};pointer-events:none;`;
  host.attachShadow({ mode: 'open' });
  document.documentElement.append(host);
  fillHost(host);

  return host;
}

function fillHost(host: HTMLElement): void {
  const root = host.shadowRoot;
  if (root === null)
    return;

  if (root.querySelector('[data-cc-copy]') === null)
    root.innerHTML = BOX;

  bindCopy(host);
}

function bindCopy(host: HTMLElement): void {
  const btn = host.shadowRoot?.querySelector('[data-cc-copy]');
  if (btn instanceof HTMLButtonElement === false || btn.dataset.ccBound === '1')
    return;

  btn.dataset.ccBound = '1';
  btn.addEventListener('click', () => {
    void copyPanel(host, btn);
  });
}

async function copyPanel(host: HTMLElement, btn: HTMLButtonElement): Promise<void> {
  const body = host.shadowRoot?.querySelector('[data-cc-machine]');
  const text = body?.getAttribute('data-cc-text') ?? '';
  const lines = text.split('\n').filter(line => line.length > 0);
  if (lines.length === 0) {
    flashCopy(btn, 'пусто');

    return;
  }

  const snapshot = [stamp(), ...lines].join('\n');
  try {
    await navigator.clipboard.writeText(snapshot);
    flashCopy(btn, 'Скопировано');
  }
  catch (error) {
    if (copyFallback(snapshot))
      flashCopy(btn, 'Скопировано');
    else
      flashCopy(btn, copyError(error));
  }
}

function flashCopy(btn: HTMLButtonElement, note: string): void {
  const span = btn.querySelector('[data-cc-copy-note]');
  if (span === null)
    return;

  span.textContent = note;
  window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => {
    span.textContent = '';
    copyTimer = undefined;
  }, 2000);
}

function copyError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0)
    return error.message;

  return 'не скопировалось';
}

function copyFallback(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.documentElement.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  }
  catch {
    ok = false;
  }
  area.remove();

  return ok;
}

function stamp(): string {
  const date = new Date();
  const tz = -date.getTimezoneOffset();
  const sign = tz >= 0 ? '+' : '-';
  const abs = Math.abs(tz);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function paintCss(): void {
  const text = `#${HOST_ID},#${HOST_ID}:popover-open{position:fixed;inset:auto auto 12px 12px;margin:0;border:0;padding:0;background:transparent;width:220px;height:fit-content;overflow:visible;z-index:${Z};pointer-events:none}#${HOST_ID}[data-cc-shut]{display:none !important}#${HOST_ID}::backdrop{display:none;pointer-events:none}`;
  const found = document.getElementById(`${HOST_ID}-css`);
  if (found instanceof HTMLStyleElement) {
    if (found.textContent !== text)
      found.textContent = text;

    return;
  }

  const css = document.createElement('style');
  css.id = `${HOST_ID}-css`;
  css.textContent = text;
  document.documentElement.append(css);
}

function keepZ(host: HTMLElement): void {
  if (host.style.zIndex !== Z)
    host.style.zIndex = Z;
}

function raise(host: HTMLElement): void {
  try {
    if (host.matches(':popover-open') === false)
      host.showPopover();
  }
  catch {
  }
}
