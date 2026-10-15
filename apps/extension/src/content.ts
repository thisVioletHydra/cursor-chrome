import { serverMode } from './local/server-mode';
import { keepHhClicks } from './hh/stay-on-tab';
import { startHhJob } from './hh/job';
import { runApply } from './hh/apply-run';
import { click, hover, pressKey, selectOption, typeInto } from './page/actions';
import { byRef, bySelector, snapshot } from './page/snapshot';
import { browser } from './browser-host';
import { BIND_MARK_ATTR, BIND_MARK_EVENT, bindMark, contentGateOpen, isGatedMessage, LINK_GATE_KEY, markOrigins, PAUSED_REPLY, shouldMarkPage } from './local/link-gate.ts';
import type { LinkGate } from './local/link-gate.ts';
import { getSyncUrl } from './diary/apply-log';
import { installGateFetch } from './local/gate-fetch.ts';

keepHhClicks();
// every /api/* request from this page (queue, pulse, applied…) passes the link gate; 401 closes it at once
installGateFetch({ get: keys => browser.storage.local.get(keys) as Promise<Record<string, unknown>>, set: items => browser.storage.local.set(items) }, getSyncUrl, listener => browser.storage.onChanged.addListener(listener));
// gate «без связи — пауза»: no autonomous page job while the extension is not linked to the admin
let hhJobStarted = false;
function startHhJobOnce(): void {
  if (hhJobStarted)
    return;

  hhJobStarted = true;
  void serverMode().then(thin => { if (thin === null || thin === undefined) startHhJob(); });
}
void contentGateOpen({ get: keys => browser.storage.local.get(keys) as Promise<Record<string, unknown>> }).then((open) => {
  if (open)
    startHhJobOnce();
});
// link came back while this page was open: start the job without reloading the extension
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || changes[LINK_GATE_KEY] === undefined)
    return;

  void contentGateOpen({ get: keys => browser.storage.local.get(keys) as Promise<Record<string, unknown>> }).then((open) => {
    if (open)
      startHhJobOnce();
  });
  void paintBindMark(changes[LINK_GATE_KEY].newValue as LinkGate | undefined);
});

// admin «До старта»: «установлено, но не связано» vs «связано». Only on our admin page (meta tag), never on job sites.
async function paintBindMark(gate: LinkGate | null | undefined): Promise<void> {
  if (window !== window.top || location.pathname.startsWith('/admin') === false)
    return;

  const origins = markOrigins(gate, await getSyncUrl().catch(() => ''));
  if (shouldMarkPage(location.origin, location.pathname, document.querySelector('meta[name="nojob-admin"]') !== null, origins) === false)
    return;

  const mark = bindMark(gate);
  document.documentElement.setAttribute(BIND_MARK_ATTR, mark);
  window.postMessage({ type: BIND_MARK_EVENT, mark }, location.origin);
}
function markAdmin(): void {
  void browser.storage.local.get(LINK_GATE_KEY).then(items => paintBindMark(items[LINK_GATE_KEY] as LinkGate | undefined)).catch(() => {});
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', markAdmin, { once: true });
else
  markAdmin();
watchResumePull();

const logs: Array<{ type: string; text: string; time: number }> = [];
const MAX_LOGS = 200;

hookConsole();

type PageIncoming = {
  type?: string;
  method?: string;
  params?: Record<string, unknown>;
  resume?: unknown;
  thin?: unknown;
  resumeKind?: unknown;
};

type Reply = (value?: unknown) => void;

const onPageMessage: Record<string, (message: PageIncoming, reply: Reply) => boolean> = {
  ping: (_message, reply) => {
    reply({ ok: true, href: location.href, title: document.title });

    return true;
  },
  'run-apply': (message, reply) => {
    if (window !== window.top)
      return false;

    void runApply(message.resume === true, message.thin === true, message.resumeKind === 'frontend' || message.resumeKind === 'fullstack' ? message.resumeKind : null).then(reply).catch((error) => {
      reply({
        ok: false,
        status: 'skip',
        reason: error instanceof Error ? error.message : String(error),
      });
    });

    return true;
  },
  command: (message, reply) => {
    void handle(String(message.method || ''), message.params || {}).then(reply).catch((error) => {
      reply({ error: error instanceof Error ? error.message : String(error) });
    });

    return true;
  },
};

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;
  if (typeof type !== 'string')
    return false;

  if (isGatedMessage(type) === false)
    return onPageMessage[type]?.(message, sendResponse) ?? false;

  if (onPageMessage[type] === undefined)
    return false;

  void contentGateOpen({ get: keys => browser.storage.local.get(keys) as Promise<Record<string, unknown>> }).then((open) => {
    if (open)
      onPageMessage[type]?.(message, sendResponse);
    else
      sendResponse(PAUSED_REPLY);
  });

  return true;
});

function watchResumePull(): void {
  if (window !== window.top)
    return;

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin)
      return;

    const data = event.data;
    if (typeof data !== 'object' || data === null || data.type !== 'cc-pull-resume')
      return;

    void browser.runtime.sendMessage({ type: 'pull-resume' }).then((reply) => {
      window.postMessage({
        type: 'cc-pull-resume-result',
        ok: replyOk(reply),
        reason: replyReason(reply),
      }, location.origin);
    }).catch(() => {
      window.postMessage({ type: 'cc-pull-resume-result', ok: false, reason: 'расширение не ответило' }, location.origin);
    });
  });
}

function replyOk(reply: unknown): boolean {
  return typeof reply === 'object' && reply !== null && 'ok' in reply && reply.ok === true;
}

function replyReason(reply: unknown): string {
  if (typeof reply !== 'object' || reply === null)
    return '';

  if ('reason' in reply && typeof reply.reason === 'string' && reply.reason.length > 0)
    return reply.reason;

  if ('error' in reply && typeof reply.error === 'string')
    return reply.error;

  return '';
}

function hookConsole(): void {
  for (const type of ['log', 'warn', 'error', 'info'] as const) {
    const original = console[type].bind(console);
    console[type] = (...args: unknown[]) => {
      logs.push({
        type,
        text: args.map(stringify).join(' '),
        time: Date.now(),
      });
      if (logs.length > MAX_LOGS)
        logs.shift();

      original(...args);
    };
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string')
    return value;

  try {
    return JSON.stringify(value);
  }
  catch {
    return String(value);
  }
}

const pageCommands: Record<string, (params: Record<string, unknown>) => unknown> = {
  browser_snapshot: () => snapshot(),
  browser_click: params => click(targetOf(params)),
  browser_hover: params => hover(targetOf(params)),
  browser_type: params => typeInto(targetOf(params), String(params.text || ''), Boolean(params.submit)),
  browser_select_option: params => selectOption(targetOf(params), asStringArray(params.values)),
  browser_press_key: params => pressKey(String(params.key || '')),
  browser_get_console_logs: () => logs.slice(),
};

async function handle(method: string, params: Record<string, unknown>): Promise<unknown> {
  const run = pageCommands[method];
  if (run === undefined)
    throw new Error(`Unknown command ${method}`);

  return run(params);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)) : [];
}

function targetOf(params: Record<string, unknown>): HTMLElement {
  const ref = String(params.ref || '');
  const selector = String(params.selector || '');
  if (ref && selector)
    throw new Error('Pass either ref or selector, not both');

  if (selector.length > 0)
    return bySelector(selector);

  return byRef(ref);
}
