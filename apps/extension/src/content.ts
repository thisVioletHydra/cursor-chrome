import { click, hover, pressKey, selectOption, typeInto } from './actions';
import { byRef, bySelector, snapshot } from './snapshot';

const logs: Array<{ type: string; text: string; time: number }> = [];
const MAX_LOGS = 200;

hookConsole();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ping') {
    sendResponse({ ok: true, href: location.href, title: document.title });

    return true;
  }

  if (message?.type === 'command') {
    void handle(message.method, message.params || {}).then(sendResponse).catch((error) => {
      sendResponse({ error: error instanceof Error ? error.message : String(error) });
    });

    return true;
  }

  return false;
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

async function handle(method: string, params: Record<string, unknown>): Promise<unknown> {
  if (method === 'browser_snapshot')
    return snapshot();

  if (method === 'browser_click')
    return click(targetOf(params));

  if (method === 'browser_hover')
    return hover(targetOf(params));

  if (method === 'browser_type')
    return typeInto(targetOf(params), String(params.text || ''), Boolean(params.submit));

  if (method === 'browser_select_option')
    return selectOption(targetOf(params), asStringArray(params.values));

  if (method === 'browser_press_key')
    return pressKey(String(params.key || ''));

  if (method === 'browser_get_console_logs')
    return logs.slice();

  throw new Error(`Unknown command ${method}`);
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
