const REF_ATTR = 'data-cc-ref';
const logs: Array<{ type: string; text: string; time: number }> = [];
const MAX_LOGS = 200;

hookConsole();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ping') {
    sendResponse({ ok: true });
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
    return click(String(params.ref || ''));
  if (method === 'browser_hover')
    return hover(String(params.ref || ''));
  if (method === 'browser_type')
    return typeInto(String(params.ref || ''), String(params.text || ''), Boolean(params.submit));
  if (method === 'browser_select_option')
    return selectOption(String(params.ref || ''), asStringArray(params.values));
  if (method === 'browser_press_key')
    return pressKey(String(params.key || ''));
  if (method === 'browser_get_console_logs')
    return logs.slice();
  throw new Error(`Unknown command ${method}`);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)) : [];
}

function snapshot(): string {
  document.querySelectorAll(`[${REF_ATTR}]`).forEach(el => el.removeAttribute(REF_ATTR));
  let next = 1;
  const lines: string[] = [
    `- page url=${location.href}`,
    `- title ${JSON.stringify(document.title)}`,
  ];

  const walk = (node: Element, depth: number) => {
    if (!isShown(node))
      return;
    const role = roleOf(node);
    const name = nameOf(node);
    const interesting = Boolean(role && (name || INTERACTIVE.has(role) || HEADINGS.has(role)));
    if (interesting) {
      const ref = `e${next++}`;
      node.setAttribute(REF_ATTR, ref);
      const bits = [`${'  '.repeat(depth)}- ${role}`];
      if (name)
        bits.push(JSON.stringify(name));
      if (role === 'heading') {
        const level = node.tagName.match(/^H(\d)$/)?.[1];
        if (level)
          bits.push(`[level=${level}]`);
      }
      bits.push(`[ref=${ref}]`);
      if ((node as HTMLInputElement).disabled)
        bits.push('[disabled]');
      lines.push(bits.join(' '));
    }
    const childDepth = interesting ? depth + 1 : depth;
    for (const child of Array.from(node.children))
      walk(child, childDepth);
  };

  walk(document.body, 0);
  return lines.join('\n');
}

const INTERACTIVE = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio',
  'combobox', 'listbox', 'option', 'switch', 'tab', 'menuitem',
  'slider', 'spinbutton',
]);
const HEADINGS = new Set(['heading', 'img']);

function roleOf(el: Element): string {
  const explicit = el.getAttribute('role');
  if (explicit)
    return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a' && el.hasAttribute('href'))
    return 'link';
  if (tag === 'button')
    return 'button';
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type || 'text';
    if (type === 'submit' || type === 'button' || type === 'reset')
      return 'button';
    if (type === 'checkbox')
      return 'checkbox';
    if (type === 'radio')
      return 'radio';
    if (type === 'search')
      return 'searchbox';
    return 'textbox';
  }
  if (tag === 'textarea')
    return 'textbox';
  if (tag === 'select')
    return 'combobox';
  if (tag === 'option')
    return 'option';
  if (/^h[1-6]$/.test(tag))
    return 'heading';
  if (tag === 'img')
    return 'img';
  if ((el as HTMLElement).isContentEditable)
    return 'textbox';
  return '';
}

function nameOf(el: Element): string {
  const labelled = el.getAttribute('aria-label')
    || el.getAttribute('alt')
    || el.getAttribute('title')
    || el.getAttribute('placeholder')
    || (el as HTMLInputElement).labels?.[0]?.innerText;
  if (labelled)
    return collapse(labelled);
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
    return collapse((el as HTMLInputElement).value || '');
  const text = collapse(el.textContent || '');
  if (text.length > 80)
    return `${text.slice(0, 77)}...`;
  return text;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isShown(el: Element): boolean {
  if (!(el instanceof HTMLElement))
    return false;
  if (el.closest('[aria-hidden="true"]'))
    return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
    return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 || el.tagName === 'OPTION';
}

function byRef(ref: string): HTMLElement {
  if (!ref)
    throw new Error('ref is required; take a snapshot first');
  const el = document.querySelector(`[${REF_ATTR}="${CSS.escape(ref)}"]`);
  if (!(el instanceof HTMLElement))
    throw new Error(`ref ${ref} not found; take a new snapshot`);
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  return el;
}

function click(ref: string): { ok: true } {
  const el = byRef(ref);
  el.focus();
  el.click();
  return { ok: true };
}

function hover(ref: string): { ok: true } {
  const el = byRef(ref);
  const rect = el.getBoundingClientRect();
  const opts: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  el.dispatchEvent(new MouseEvent('mouseover', opts));
  el.dispatchEvent(new MouseEvent('mouseenter', opts));
  el.dispatchEvent(new MouseEvent('mousemove', opts));
  return { ok: true };
}

function typeInto(ref: string, text: string, submit: boolean): { ok: true } {
  const el = byRef(ref);
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  else if (el.isContentEditable) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
  }
  else {
    throw new Error('Element is not editable');
  }
  if (submit)
    pressOn(el, 'Enter');
  return { ok: true };
}

function selectOption(ref: string, values: string[]): { ok: true } {
  const el = byRef(ref);
  if (!(el instanceof HTMLSelectElement))
    throw new Error('Element is not a select');
  const wanted = new Set(values);
  for (const option of Array.from(el.options))
    option.selected = wanted.has(option.value) || wanted.has(option.label) || wanted.has(option.text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
}

function pressKey(key: string): { ok: true } {
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  pressOn(target, key);
  return { ok: true };
}

function pressOn(el: HTMLElement, key: string): void {
  const eventInit: KeyboardEventInit = {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    bubbles: true,
    cancelable: true,
  };
  el.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  el.dispatchEvent(new KeyboardEvent('keypress', eventInit));
  el.dispatchEvent(new KeyboardEvent('keyup', eventInit));
}
