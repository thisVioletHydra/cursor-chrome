import { sleep } from './dom';

const FULLSTACK = /fullstack/i;

let pickAt = 0;

export async function ensureFullstack(ms = 6000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    pickFullstack();
    if (currentIsFullstack())
      return true;

    await sleep(200);
  }

  return currentIsFullstack();
}

export function pickFullstack(): void {
  if (hasApplyChrome() === false || Date.now() - pickAt < 800)
    return;

  const steps = [
    () => {
      if (selectNativeFullstack() === false)
        return false;

      pickAt = Date.now();

      return true;
    },
    () => currentIsFullstack(),
    () => {
      const option = findFullstackOption();
      if (option === null)
        return false;

      pickAt = Date.now();
      option.click();

      return true;
    },
    () => document.querySelector('[role="listbox"]') !== null,
    () => {
      const trigger = findResumeTrigger();
      if (trigger === null || FULLSTACK.test(trigger.textContent || ''))
        return false;

      pickAt = Date.now();
      trigger.click();

      return true;
    },
  ];

  steps.some(step => step());
}

function selectNativeFullstack(): boolean {
  const selects = Array.from(document.querySelectorAll('select'));
  for (const select of selects) {
    const hit = Array.from(select.options).find(item => FULLSTACK.test(item.text));
    if (hit === undefined || select.value === hit.value)
      continue;

    select.value = hit.value;
    select.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));

    return true;
  }

  return false;
}

function hasApplyChrome(): boolean {
  return Boolean(document.querySelector([
    '[data-qa*="vacancy-response"]',
    '[data-qa*="response-popup"]',
    '[data-qa="vacancy-response-popup"]',
    'form[action*="response"]',
  ].join(',')));
}

function currentIsFullstack(): boolean {
  const trigger = findResumeTrigger();
  if (FULLSTACK.test(trigger?.textContent || ''))
    return true;

  return [...document.querySelectorAll('select')].some(select => FULLSTACK.test(select.selectedOptions[0]?.text || ''));
}

function findResumeTrigger(): HTMLElement | null {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>([
    '[data-qa="resume-select"] button',
    '[data-qa="resume"] button',
    '[data-qa="cell"]',
    'button[class*="select"]',
    'select',
  ].join(',')));

  return nodes.find(element => /разработчик|frontend|fullstack|resume/i.test(element.textContent || element.getAttribute('data-qa') || ''))
    || null;
}

function findFullstackOption(): HTMLElement | null {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>([
    '[data-qa="resume-title"]',
    '[role="option"]',
    '[data-qa*="resume"] [role="listbox"] *',
    'select option',
  ].join(',')));

  return nodes.find(element => FULLSTACK.test(element.textContent || '')) || null;
}
