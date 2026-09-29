import { ask } from './bridge';

const TO_VACANCY = /перейти\s+к\s+вакансии/i;

export function keepHhClicks(): void {
  if (window !== window.top || onHhPage() === false)
    return;

  window.addEventListener('click', onHhClick, true);
  window.addEventListener('auxclick', onHhClick, true);
}

export function blockedHref(element: Element): string | null {
  return hrefFor(element, false);
}

function onHhPage(): boolean {
  return /(^|\.)hh\.ru$/i.test(location.hostname);
}

function onHhClick(event: Event): void {
  if (event instanceof MouseEvent === false)
    return;

  const node = event.composedPath().find((item): item is Element => item instanceof Element);
  if (node === undefined)
    return;

  const modified = event.button === 1 || event.metaKey || event.ctrlKey || event.shiftKey;
  const href = hrefFor(node, modified);
  if (href === null)
    return;

  const host = node.closest('a, button, [role="button"]');
  if (host instanceof HTMLElement)
    host.style.color = '#15803d';

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  if (href.length === 0)
    return;

  void ask({ type: 'hh-same-tab', url: href });
}

function hrefFor(node: Element, modified: boolean): string | null {
  const host = node.closest('a, button, [role="button"]');
  if (host === null)
    return null;

  const link = host instanceof HTMLAnchorElement ? host : host.closest('a');
  const label = host.textContent?.replace(/\s+/g, ' ').trim() || '';
  const href = link instanceof HTMLAnchorElement ? link.href : '';
  const toVacancy = TO_VACANCY.test(label);
  const fresh = modified || (link instanceof HTMLAnchorElement && opensFresh(link));
  if (toVacancy === false && fresh === false)
    return null;

  if (toVacancy || vacancyHref(href) || hhHref(href))
    return href || vacancyFromCard(host);

  return null;
}

function opensFresh(link: HTMLAnchorElement): boolean {
  const base = document.querySelector('base')?.getAttribute('target') || '';
  const target = link.target || base;

  return target === '_blank' || target === '_new';
}

function vacancyHref(href: string): boolean {
  return /\/vacancy\/|vacancyId=|vacancy_response/i.test(href);
}

function hhHref(href: string): boolean {
  try {
    const host = new URL(href).hostname.toLowerCase();

    return host === 'hh.ru' || host.endsWith('.hh.ru');
  }
  catch {
    return false;
  }
}

function vacancyFromCard(node: Element): string {
  const card = node.closest('article, [data-qa*="vacancy"], li');
  const link = card?.querySelector('a[href*="/vacancy/"]');
  if (link instanceof HTMLAnchorElement && link.href.length > 0)
    return link.href;

  return '';
}
