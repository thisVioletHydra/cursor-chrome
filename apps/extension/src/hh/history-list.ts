import { isJunkApply } from '../chrome/apply-log';

export type HistoryItem = {
  title: string;
  company: string;
  url: string;
  vacancyId: string;
  hints?: string[];
};

export function labeledApplies<T extends HistoryItem>(items: T[]): T[] {
  return items.filter((item) => {
    if (isJunkApply(item))
      return false;

    return item.title.trim().length > 0 || item.company.trim().length > 0 || item.vacancyId.length > 0;
  });
}

export function paintApplyGroup(
  root: HTMLElement,
  label: string,
  items: HistoryItem[],
  start: number,
  opts: {
    heading?: 'h3' | 'h4';
    kind?: string;
    empty?: string;
    emptyClass?: string;
  } = {},
): number {
  if (items.length === 0 && opts.empty === undefined)
    return start;

  const heading = document.createElement(opts.heading || 'h3');
  heading.textContent = label;
  if (opts.kind)
    heading.className = opts.kind;

  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = opts.emptyClass || 'empty';
    empty.textContent = opts.empty || '';
    root.append(heading, empty);

    return start;
  }

  const list = document.createElement('ol');
  list.start = start;
  list.style.counterReset = `apply ${start - 1}`;
  for (const item of items) {
    const row = document.createElement('li');
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    const who = item.company ? ` — ${item.company}` : '';
    const hint = item.hints?.[0] ? ` · ${item.hints[0]}` : '';
    link.textContent = `${item.title || item.vacancyId}${who}${hint}`;
    row.append(link);
    list.append(row);
  }

  root.append(heading, list);

  return start + items.length;
}
