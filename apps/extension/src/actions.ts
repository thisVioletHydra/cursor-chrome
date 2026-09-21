export function click(element: HTMLElement): { ok: true } {
  element.focus();
  element.click();

  return { ok: true };
}

export function hover(element: HTMLElement): { ok: true } {
  const rect = element.getBoundingClientRect();
  const opts: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  element.dispatchEvent(new MouseEvent('mouseover', opts));
  element.dispatchEvent(new MouseEvent('mouseenter', opts));
  element.dispatchEvent(new MouseEvent('mousemove', opts));

  return { ok: true };
}

export function typeInto(element: HTMLElement, text: string, submit: boolean): { ok: true } {
  element.focus();
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
    fillControl(element, text);
  else if (element.isContentEditable)
    fillEditable(element, text);
  else
    throw new Error('Element is not editable');

  if (submit)
    pressOn(element, 'Enter');

  return { ok: true };
}

export function selectOption(element: HTMLElement, values: string[]): { ok: true } {
  if (!(element instanceof HTMLSelectElement))
    throw new Error('Element is not a select');

  const wanted = new Set(values);
  for (const option of Array.from(element.options))
    option.selected = wanted.has(option.value) || wanted.has(option.label) || wanted.has(option.text);

  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));

  return { ok: true };
}

export function pressKey(key: string): { ok: true } {
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  pressOn(target, key);

  return { ok: true };
}

function fillControl(element: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  try {
    element.select();
  }
  catch {
    element.setSelectionRange?.(0, element.value.length);
  }

  if (document.execCommand('insertText', false, text) && element.value === text) {
    fireChange(element);

    return;
  }

  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, text);
  fireInput(element, text);
}

function fillEditable(element: HTMLElement, text: string): void {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);
  if (document.execCommand('insertText', false, text)) {
    fireChange(element);

    return;
  }

  element.textContent = text;
  fireInput(element, text);
}

function fireInput(element: HTMLElement, text: string): void {
  element.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType: 'insertText',
    data: text,
  }));
  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    composed: true,
    inputType: 'insertText',
    data: text,
  }));
  fireChange(element);
}

function fireChange(element: HTMLElement): void {
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function pressOn(element: HTMLElement, key: string): void {
  const eventInit: KeyboardEventInit = {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  element.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  element.dispatchEvent(new KeyboardEvent('keypress', eventInit));
  element.dispatchEvent(new KeyboardEvent('keyup', eventInit));
}
