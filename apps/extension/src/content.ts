const REF_ATTR = 'data-cc-ref';
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
  if (selector)
    return bySelector(selector);
  return byRef(ref);
}

function snapshot(): string {
  clearRefs(document);
  let next = 1;
  const lines: string[] = [
    `- page url=${location.href}`,
    `- title ${JSON.stringify(document.title)}`,
  ];

  const walk = (node: Element, depth: number) => {
    if (!isPainted(node))
      return;
    const role = roleOf(node);
    const name = nameOf(node);
    const interesting = Boolean(role && (name || INTERACTIVE.has(role) || HEADINGS.has(role)));
    if (interesting && isShown(node)) {
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
    const childDepth = interesting && isShown(node) ? depth + 1 : depth;
    for (const child of Array.from(node.children))
      walk(child, childDepth);
    const root = shadowRootOf(node);
    if (root) {
      for (const child of Array.from(root.children))
        walk(child, childDepth);
    }
  };

  if (document.body)
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

function isFormControl(el: Element): boolean {
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON')
    return true;
  if ((el as HTMLElement).isContentEditable)
    return true;
  return INTERACTIVE.has(roleOf(el));
}

function isPainted(el: Element): boolean {
  if (!(el instanceof HTMLElement))
    return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function isShown(el: Element): boolean {
  if (!isPainted(el))
    return false;
  if (isFormControl(el))
    return true;
  if (el.closest('[aria-hidden="true"]'))
    return false;
  if (getComputedStyle(el).opacity === '0')
    return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 || el.tagName === 'OPTION';
}

function shadowRootOf(el: Element): ShadowRoot | null {
  try {
    const opened = chrome.dom?.openOrClosedShadowRoot?.(el);
    if (opened)
      return opened;
  }
  catch {
    // API missing or node not an element host
  }
  return el.shadowRoot;
}

function clearRefs(root: ParentNode): void {
  if (root instanceof Element && root.hasAttribute(REF_ATTR))
    root.removeAttribute(REF_ATTR);
  for (const el of Array.from(root.querySelectorAll(`[${REF_ATTR}]`)))
    el.removeAttribute(REF_ATTR);
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const sr = shadowRootOf(el);
    if (sr)
      clearRefs(sr);
  }
}

function deepQuery(selector: string): HTMLElement | null {
  const search = (root: ParentNode): HTMLElement | null => {
    try {
      const hit = root.querySelector(selector);
      if (hit instanceof HTMLElement)
        return hit;
    }
    catch {
      throw new Error(`Invalid CSS selector: ${selector}`);
    }
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const sr = shadowRootOf(el);
      if (!sr)
        continue;
      const nested = search(sr);
      if (nested)
        return nested;
    }
    return null;
  };
  return search(document);
}

function byRef(ref: string): HTMLElement {
  if (!ref)
    throw new Error('ref or selector is required');
  const el = deepQuery(`[${REF_ATTR}="${CSS.escape(ref)}"]`);
  if (!(el instanceof HTMLElement))
    throw new Error(`ref ${ref} not found; take a new snapshot`);
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  return el;
}

function bySelector(selector: string): HTMLElement {
  if (!selector)
    throw new Error('selector is required');
  const el = deepQuery(selector);
  if (!(el instanceof HTMLElement))
    throw new Error(`selector not found: ${selector}`);
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  return el;
}

function click(el: HTMLElement): { ok: true } {
  el.focus();
  el.click();
  return { ok: true };
}

function hover(el: HTMLElement): { ok: true } {
  const rect = el.getBoundingClientRect();
  const opts: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  el.dispatchEvent(new MouseEvent('mouseover', opts));
  el.dispatchEvent(new MouseEvent('mouseenter', opts));
  el.dispatchEvent(new MouseEvent('mousemove', opts));
  return { ok: true };
}

function typeInto(el: HTMLElement, text: string, submit: boolean): { ok: true } {
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
    fillControl(el, text);
  else if (el.isContentEditable)
    fillEditable(el, text);
  else
    throw new Error('Element is not editable');
  if (submit)
    pressOn(el, 'Enter');
  return { ok: true };
}

function fillControl(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  try {
    el.select();
  }
  catch {
    el.setSelectionRange?.(0, el.value.length);
  }
  if (document.execCommand('insertText', false, text) && el.value === text) {
    fireChange(el);
    return;
  }
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
  fireInput(el, text);
}

function fillEditable(el: HTMLElement, text: string): void {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  selection?.removeAllRanges();
  selection?.addRange(range);
  if (document.execCommand('insertText', false, text)) {
    fireChange(el);
    return;
  }
  el.textContent = text;
  fireInput(el, text);
}

function fireInput(el: HTMLElement, text: string): void {
  el.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType: 'insertText',
    data: text,
  }));
  el.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    composed: true,
    inputType: 'insertText',
    data: text,
  }));
  fireChange(el);
}

function fireChange(el: HTMLElement): void {
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function selectOption(el: HTMLElement, values: string[]): { ok: true } {
  if (!(el instanceof HTMLSelectElement))
    throw new Error('Element is not a select');
  const wanted = new Set(values);
  for (const option of Array.from(el.options))
    option.selected = wanted.has(option.value) || wanted.has(option.label) || wanted.has(option.text);
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
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
    composed: true,
  };
  el.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  el.dispatchEvent(new KeyboardEvent('keypress', eventInit));
  el.dispatchEvent(new KeyboardEvent('keyup', eventInit));
}
