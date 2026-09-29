import { isJunkApply } from '../chrome/apply-log';

export type HistoryItem = {
  title: string;
  company: string;
  url: string;
  vacancyId: string;
  sentAt?: number;
  hints?: string[];
};

export function readWaitingKey(button: HTMLButtonElement): {
  vacancyId: string;
  sentAt: number;
  title: string;
  company: string;
} {
  const sentAt = Number(button.dataset.sentAt);

  return {
    vacancyId: button.dataset.vacancyId || '',
    sentAt: Number.isFinite(sentAt) ? sentAt : 0,
    title: button.dataset.title || '',
    company: button.dataset.company || '',
  };
}

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
    drop?: boolean;
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
    link.rel = 'noreferrer';
    const who = item.company ? ` — ${item.company}` : '';
    const hint = item.hints?.[0] ? ` · ${item.hints[0]}` : '';
    link.textContent = `${item.title || item.vacancyId}${who}${hint}`;
    row.append(link);
    if (opts.drop === true)
      row.append(dropWaitButton(item));

    list.append(row);
  }

  root.append(heading);
  if (opts.drop === true && items.length > 0)
    root.append(clearWaitButton());

  root.append(list);

  return start + items.length;
}

function clearWaitButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cc-clear';
  button.dataset.ccClearWait = '';
  button.textContent = 'очистить';

  return button;
}

function dropWaitButton(item: HistoryItem): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cc-drop';
  button.dataset.ccDrop = '';
  button.dataset.vacancyId = item.vacancyId;
  button.dataset.sentAt = String(item.sentAt ?? 0);
  button.dataset.title = item.title;
  button.dataset.company = item.company;
  button.title = 'убрать';
  button.setAttribute('aria-label', 'убрать');
  button.textContent = '×';

  return button;
}
