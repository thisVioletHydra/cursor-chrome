import { compact, sleep, visible } from './dom';
import { applyRoot } from './screen-questions';

export type ResumeKind = 'frontend' | 'fullstack';

const NAME: Record<ResumeKind, RegExp> = {
  frontend: /frontend|front[\s-]?end|фронтенд/i,
  fullstack: /fullstack|full[\s-]?stack|фул+стек/i,
};

const BACKEND = /fullstack|full[\s-]?stack|фул+стек|backend|бэкенд|бекенд|back[\s-]?end|настрано\s+про\s+бэкенд/i;
const FRONTEND = /frontend|front[\s-]?end|фронтенд/i;

const TRIGGER_SEL = [
  '[data-qa="resume-select"] button',
  '[data-qa="resume"] button',
  'button[class*="select"]',
  '[data-qa="cell"]',
];

const OPTION_SEL = [
  '[data-qa="resume-title"]',
  '[data-qa*="select-option"]',
  '[role="option"]',
  '[data-qa*="resume"] [role="listbox"] *',
].join(',');

export function resumeKind(title: string, body: string): ResumeKind | null {
  const head = compact(title);
  const text = compact(`${title}\n${body}`);
  if (BACKEND.test(head))
    return 'fullstack';

  if (FRONTEND.test(head))
    return 'frontend';

  if (BACKEND.test(text))
    return 'fullstack';

  if (FRONTEND.test(text))
    return 'frontend';

  return null;
}

export function vacancyTitle(): string {
  return document.querySelector('[data-qa="vacancy-title"]')?.textContent
    || document.querySelector('h1')?.textContent
    || '';
}

export function vacancyBody(): string {
  return document.querySelector('[data-qa="vacancy-description"]')?.textContent || '';
}

/** Выбирает резюме по названию. Если такого пункта нет, текущий выбор не трогает. */
export async function pickResume(kind: ResumeKind): Promise<void> {
  const name = NAME[kind];
  if (applyRoot() === null || selected(name))
    return;

  if (selectNative(name))
    return;

  const trigger = findResumeTrigger();
  if (trigger === null)
    return;

  trigger.click();
  const end = Date.now() + 1200;
  while (Date.now() < end) {
    if (selectNative(name) || clickOption(name))
      return;

    await sleep(200);
  }

  dismissList();
}

function selected(name: RegExp): boolean {
  const trigger = findResumeTrigger();
  if (trigger !== null && name.test(trigger.textContent || ''))
    return true;

  return resumeSelects().some(select => name.test(select.selectedOptions[0]?.text || ''));
}

function selectNative(name: RegExp): boolean {
  for (const select of resumeSelects()) {
    const hit = [...select.options].find(item => name.test(item.text));
    if (hit === undefined)
      continue;

    if (select.value === hit.value)
      return true;

    select.value = hit.value;
    select.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));

    return true;
  }

  return false;
}

function clickOption(name: RegExp): boolean {
  const hits = [...document.querySelectorAll<HTMLElement>(OPTION_SEL)].filter((element) => {
    if (visible(element) === false)
      return false;

    const text = compact(element.textContent || '');

    return text.length > 0 && text.length < 120 && name.test(text);
  });
  const hit = hits.sort((left, right) => compact(left.textContent || '').length - compact(right.textContent || '').length)[0];
  if (hit === undefined)
    return false;

  hit.click();

  return true;
}

function findResumeTrigger(): HTMLElement | null {
  for (const sel of TRIGGER_SEL) {
    const hit = [...document.querySelectorAll<HTMLElement>(sel)]
      .find(element => visible(element) && /разработчик|frontend|фронтенд|fullstack|фулстек|resume|резюме/i.test(element.textContent || ''));
    if (hit)
      return hit;
  }

  return null;
}

function resumeSelects(): HTMLSelectElement[] {
  const root = applyRoot() ?? document;

  return [...root.querySelectorAll('select')];
}

function dismissList(): void {
  if (document.querySelector('[role="listbox"]') === null)
    return;

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
}
