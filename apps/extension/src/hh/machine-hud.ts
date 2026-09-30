import { machineWanted, readSnap, statusLines } from './machine-read';
import { browser } from '../browser-host';

const HOST_ID = 'cc-hh-machine';
const Z = '2147483646';
const TICK_MS = 1000;

let mounted = false;
let epoch = 0;
let timer: number | undefined;
let pulling = false;
let dirty = false;

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

    return existing;
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('popover', 'manual');
  host.setAttribute('data-cc-shut', '');
  host.style.cssText = `position:fixed;inset:12px auto auto 12px;margin:0;padding:0;border:0;background:transparent;width:220px;height:fit-content;overflow:visible;z-index:${Z};pointer-events:none;`;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<style>:host{display:block;pointer-events:none}.cc-box{width:220px;background:#111;border:1px solid #333;border-radius:10px;padding:6px 8px;box-shadow:0 8px 24px #0008;font:12px/1.35 ui-sans-serif,system-ui,sans-serif;color:#eee}p{margin:0 0 2px;overflow-wrap:anywhere}p:last-child{margin:0}.cc-bad{color:#fbbf24}</style><div class="cc-box" data-cc-machine></div>';
  document.documentElement.append(host);

  return host;
}

function paintCss(): void {
  const text = `#${HOST_ID},#${HOST_ID}:popover-open{position:fixed;inset:12px auto auto 12px;margin:0;border:0;padding:0;background:transparent;width:220px;height:fit-content;overflow:visible;z-index:${Z};pointer-events:none}#${HOST_ID}[data-cc-shut]{display:none !important}#${HOST_ID}::backdrop{display:none;pointer-events:none}`;
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
