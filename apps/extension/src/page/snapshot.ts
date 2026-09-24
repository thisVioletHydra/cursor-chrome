import { browser } from '../browser-host';

export const REF_ATTR = 'data-cc-ref';

const INTERACTIVE = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'option',
  'switch',
  'tab',
  'menuitem',
  'slider',
  'spinbutton',
]);
const HEADINGS = new Set(['heading', 'img']);
const FORM_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);
const TAG_ROLE: Record<string, string> = {
  button: 'button',
  textarea: 'textbox',
  select: 'combobox',
  option: 'option',
  img: 'img',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
};
const INPUT_ROLE: Record<string, string> = {
  submit: 'button',
  button: 'button',
  reset: 'button',
  checkbox: 'checkbox',
  radio: 'radio',
  search: 'searchbox',
};

export function snapshot(): string {
  clearRefs(document);
  let next = 1;
  const lines: string[] = [
    `- page url=${location.href}`,
    `- title ${JSON.stringify(document.title)}`,
  ];

  const walk = (node: Element, depth: number) => {
    if (isPainted(node) === false)
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

export function byRef(ref: string): HTMLElement {
  if (ref.length === 0)
    throw new Error('ref or selector is required');

  const element = deepQuery(`[${REF_ATTR}="${CSS.escape(ref)}"]`);
  if (!(element instanceof HTMLElement))
    throw new Error(`ref ${ref} not found; take a new snapshot`);

  element.scrollIntoView({ block: 'center', inline: 'nearest' });

  return element;
}

export function bySelector(selector: string): HTMLElement {
  if (selector.length === 0)
    throw new Error('selector is required');

  const element = deepQuery(selector);
  if (!(element instanceof HTMLElement))
    throw new Error(`selector not found: ${selector}`);

  element.scrollIntoView({ block: 'center', inline: 'nearest' });

  return element;
}

function roleOf(element: Element): string {
  const explicit = element.getAttribute('role');
  if (explicit)
    return explicit;

  const tag = element.tagName.toLowerCase();
  if (tag === 'input')
    return INPUT_ROLE[(element as HTMLInputElement).type] || 'textbox';

  if (tag === 'a')
    return element.hasAttribute('href') ? 'link' : '';

  return TAG_ROLE[tag] || ((element as HTMLElement).isContentEditable ? 'textbox' : '');
}

function nameOf(element: Element): string {
  const labelled = element.getAttribute('aria-label')
    || element.getAttribute('alt')
    || element.getAttribute('title')
    || element.getAttribute('placeholder')
    || (element as HTMLInputElement).labels?.[0]?.innerText;
  if (labelled)
    return collapse(labelled);

  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT')
    return collapse((element as HTMLInputElement).value || '');

  const text = collapse(element.textContent || '');
  if (text.length > 80)
    return `${text.slice(0, 77)}...`;

  return text;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isFormControl(element: Element): boolean {
  if (FORM_TAGS.has(element.tagName))
    return true;

  if ((element as HTMLElement).isContentEditable)
    return true;

  return INTERACTIVE.has(roleOf(element));
}

function isPainted(element: Element): boolean {
  if (!(element instanceof HTMLElement))
    return false;

  const style = getComputedStyle(element);

  return style.display !== 'none' && style.visibility !== 'hidden';
}

function isShown(element: Element): boolean {
  if (isPainted(element) === false)
    return false;

  return isFormControl(element) || visibleBox(element);
}

function visibleBox(element: Element): boolean {
  if (element.closest('[aria-hidden="true"]') || getComputedStyle(element).opacity === '0')
    return false;

  const rect = element.getBoundingClientRect();

  return rect.width > 0 || rect.height > 0 || element.tagName === 'OPTION';
}

function shadowRootOf(element: Element): ShadowRoot | null {
  try {
    const opened = browser.dom?.openOrClosedShadowRoot?.(element);
    if (opened)
      return opened;
  }
  catch {
  }

  return element.shadowRoot;
}

function clearRefs(root: ParentNode): void {
  if (root instanceof Element && root.hasAttribute(REF_ATTR))
    root.removeAttribute(REF_ATTR);

  for (const element of Array.from(root.querySelectorAll(`[${REF_ATTR}]`)))
    element.removeAttribute(REF_ATTR);

  for (const element of Array.from(root.querySelectorAll('*'))) {
    const sr = shadowRootOf(element);
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

    for (const element of Array.from(root.querySelectorAll('*'))) {
      const sr = shadowRootOf(element);
      if (sr === null)
        continue;

      const nested = search(sr);
      if (nested)
        return nested;
    }

    return null;
  };

  return search(document);
}
