export function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function visible(element: HTMLElement): boolean {
  if (element.isConnected === false)
    return false;

  if (element.getClientRects().length > 0)
    return true;

  // Фон без фокуса: раскладки ещё нет, кнопка в HTML уже есть.
  if (document.hidden === false)
    return false;

  const style = getComputedStyle(element);

  return style.display !== 'none' && style.visibility !== 'hidden' && element.hidden === false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function pause(min: number, max: number): Promise<void> {
  const ms = min + Math.floor(Math.random() * (max - min + 1));

  return sleep(ms);
}

export async function until(check: () => boolean, ms: number, step = 150): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check())
      return true;

    await sleep(step);
  }

  return check();
}

export function vacancyIdFromLocation(href = location.href): string {
  try {
    const parsed = new URL(href);

    return parsed.pathname.match(/\/vacancy\/(\d+)/)?.[1]
      || parsed.searchParams.get('vacancyId')
      || '';
  }
  catch {
    return '';
  }
}

export function onVacancyPage(): boolean {
  return /\/vacancy\/\d+/.test(location.pathname)
    || /\/applicant\/vacancy_response/i.test(location.pathname);
}
