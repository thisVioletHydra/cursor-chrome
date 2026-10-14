import { compact } from './dom';

// Capture-only: describes the employer questionnaire so the admin «Разбор» tab can draft answers.
// Nothing here fills, clicks or submits anything on hh.

export type CapturedKind = 'text' | 'number' | 'choice' | 'multi' | 'unknown';

export type CapturedChoice = { value: string; label: string };

export type CapturedQuestion = {
  prompt: string;
  kind: CapturedKind;
  options: string[];
  choices: CapturedChoice[];
  multi: boolean;
  required: boolean;
  fieldKey: string;
};

export type CapturedForm = {
  questions: CapturedQuestion[];
  text: string;
  url: string;
  at: number;
};

const CONTROL = 'textarea, input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]), select, [role="radio"], [role="checkbox"], [role="textbox"]';
const MAX_QUESTIONS = 30;
const MAX_TEXT = 6_000;
const CLIMB = 5;

export function captureForm(root: HTMLElement): CapturedForm | null {
  const items = questionItems(root);
  const questions = items.map(describe).filter((row): row is CapturedQuestion => row !== null).slice(0, MAX_QUESTIONS);
  if (questions.length === 0)
    return null;

  return { questions, text: compact(root.textContent || '').slice(0, MAX_TEXT), url: location.href, at: Date.now() };
}

function questionItems(root: HTMLElement): HTMLElement[] {
  const marked = [...root.querySelectorAll<HTMLElement>('[data-qa="task-question"]')].map(climbToControl);
  const found = marked.length > 0
    ? marked
    : [...root.querySelectorAll<HTMLElement>(CONTROL)].map(field => field.closest<HTMLElement>('.bloko-form-item, [class*="form-item"], [data-qa*="question"], fieldset'));

  return [...new Set(found.filter((item): item is HTMLElement => item !== null))].filter(item => isLetter(item) === false);
}

function climbToControl(element: HTMLElement): HTMLElement {
  let node: HTMLElement = element;
  for (let step = 0; step < CLIMB && node.parentElement; step += 1) {
    if (node.querySelector(CONTROL))
      return node;

    node = node.parentElement;
  }

  return node;
}

function isLetter(item: HTMLElement): boolean {
  const qa = [...item.querySelectorAll('textarea, input')].map(field => `${field.getAttribute('data-qa') || ''} ${field.getAttribute('name') || ''}`).join(' ');

  return /letter|сопровод|resume/i.test(qa);
}

function describe(item: HTMLElement): CapturedQuestion | null {
  const prompt = promptOf(item);
  if (prompt.length < 3)
    return null;

  const controls = [...item.querySelectorAll<HTMLElement>(CONTROL)];
  const first = controls[0];
  const kind = kindOf(controls);
  const choices = choicesOf(item, controls);

  return {
    prompt: prompt.slice(0, 1_000),
    kind,
    options: choices.map(choice => choice.label),
    choices,
    multi: kind === 'multi',
    required: controls.some(isRequired) || /\*\s*$/.test(prompt),
    fieldKey: first ? keyOf(first) : '',
  };
}

function promptOf(item: HTMLElement): string {
  const marked = item.querySelector<HTMLElement>('[data-qa="task-question"], legend, label');
  const source = marked ?? item;
  const clone = source.cloneNode(true) as HTMLElement;
  for (const nested of clone.querySelectorAll('textarea, input, select, button, svg, [role="radio"], [role="checkbox"]'))
    nested.remove();

  return compact(clone.textContent || '');
}

function kindOf(controls: readonly HTMLElement[]): CapturedKind {
  if (controls.some(field => field.getAttribute('role') === 'checkbox' || (field instanceof HTMLInputElement && field.type === 'checkbox')))
    return 'multi';

  if (controls.some(field => field.getAttribute('role') === 'radio' || (field instanceof HTMLInputElement && field.type === 'radio') || field instanceof HTMLSelectElement))
    return 'choice';

  if (controls.some(field => field instanceof HTMLInputElement && field.type === 'number'))
    return 'number';

  return controls.length > 0 ? 'text' : 'unknown';
}

function choicesOf(item: HTMLElement, controls: readonly HTMLElement[]): CapturedChoice[] {
  const select = controls.find((field): field is HTMLSelectElement => field instanceof HTMLSelectElement);
  if (select) {
    return [...select.options]
      .map(option => ({ value: option.value, label: compact(option.textContent || '') }))
      .filter(choice => choice.label.length > 0 && choice.value.length > 0);
  }

  const picks = controls.filter(field => field.getAttribute('role') === 'radio' || field.getAttribute('role') === 'checkbox' || (field instanceof HTMLInputElement && (field.type === 'radio' || field.type === 'checkbox')));

  return picks
    .map(field => ({ value: choiceValue(field), label: optionLabel(item, field) }))
    .filter(choice => choice.label.length > 0);
}

function choiceValue(field: HTMLElement): string {
  if (field instanceof HTMLInputElement && field.value.length > 0 && field.value !== 'on')
    return field.value;

  return field.getAttribute('data-value') || field.getAttribute('value') || field.id || '';
}

function optionLabel(item: HTMLElement, field: HTMLElement): string {
  const aria = field.getAttribute('aria-label') || '';
  if (aria.length > 0)
    return compact(aria);

  const byFor = field.id ? item.querySelector<HTMLElement>(`label[for="${CSS.escape(field.id)}"]`) : null;
  const label = byFor ?? field.closest('label');

  return compact(label?.textContent || field.parentElement?.textContent || '');
}

function isRequired(field: HTMLElement): boolean {
  if (field.getAttribute('aria-required') === 'true')
    return true;

  return (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) && field.required;
}

function keyOf(field: HTMLElement): string {
  return field.getAttribute('name') || field.getAttribute('data-qa') || field.id || '';
}
