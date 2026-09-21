import { click, hover, pressKey, selectOption, typeInto } from './actions';
import { startHhJob } from './hh-job';
import { byRef, bySelector, snapshot } from './snapshot';

startHhJob();

const logs: Array<{ type: string; text: string; time: number }> = [];
const MAX_LOGS = 200;

hookConsole();

type PageIncoming = {
  type?: string;
  method?: string;
  params?: Record<string, unknown>;
};

type Reply = (value?: unknown) => void;

const onPageMessage: Record<string, (message: PageIncoming, reply: Reply) => boolean> = {
  ping: (_message, reply) => {
    reply({ ok: true, href: location.href, title: document.title });

    return true;
  },
  command: (message, reply) => {
    void handle(String(message.method || ''), message.params || {}).then(reply).catch((error) => {
      reply({ error: error instanceof Error ? error.message : String(error) });
    });

    return true;
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;
  if (typeof type !== 'string')
    return false;

  return onPageMessage[type]?.(message, sendResponse) ?? false;
});

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
