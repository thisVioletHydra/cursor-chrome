export type WaitKind = 'w' | 's' | 'p';

export type WaitMark = {
  id: string;
  human: string;
  budget: number | null;
  next: string;
  kind: WaitKind;
  hold: boolean;
};

export type WaitPulse = {
  id: string;
  human: string;
  budget: number | null;
  elapsed: number;
  next: string;
  kind: WaitKind;
  hold: boolean;
};

const PULSE = /^~([a-z][a-z0-9.]*)\|([^|]+)\|(-|\d+)\|(\d+)\|([a-z][a-z0-9.]*)\|([wsp])\|([01])$/;

export function waitMark(mark: {
  id: string;
  human: string;
  budget: number | null;
  next: string;
  kind?: WaitKind;
  hold?: boolean;
}): WaitMark {
  return {
    id: mark.id,
    human: mark.human,
    budget: mark.budget,
    next: mark.next,
    kind: mark.kind ?? 'w',
    hold: mark.hold === true,
  };
}

export function budgetSec(ms: number): number {
  if (Number.isFinite(ms) === false)
    return 0;

  return Math.max(0, Math.round(ms / 1000));
}

export function waitPulse(mark: WaitMark, elapsed: number): string {
  const budget = mark.budget === null ? '-' : String(Math.max(0, Math.round(mark.budget)));
  const sec = Number.isFinite(elapsed) ? Math.max(0, Math.trunc(elapsed)) : 0;
  const hold = mark.hold ? '1' : '0';

  return `~${mark.id}|${mark.human}|${budget}|${sec}|${mark.next}|${mark.kind}|${hold}`;
}

export function readWaitPulse(text: string): WaitPulse | null {
  const hit = PULSE.exec(text);
  if (hit === null)
    return null;

  const kind = hit[6];
  if (kind !== 'w' && kind !== 's' && kind !== 'p')
    return null;

  const id = hit[1] ?? '';
  const human = hit[2] ?? '';
  const next = hit[5] ?? '';
  if (id.length === 0 || human.length === 0 || next.length === 0)
    return null;

  const rolled = hit[3] === '-' ? null : Number(hit[3]);
  const elapsed = Number(hit[4]);
  if (rolled !== null && Number.isInteger(rolled) === false)
    return null;

  if (Number.isInteger(elapsed) === false)
    return null;

  return {
    id,
    human,
    budget: rolled,
    elapsed,
    next,
    kind,
    hold: hit[7] === '1',
  };
}

export function liveState(text: string): boolean {
  return readWaitPulse(text) !== null;
}

export function pulseHolds(text: string): boolean {
  return readWaitPulse(text)?.hold === true;
}

const PLACE: Record<string, { do: string; file: string }> = {
  'apply.read': { do: 'читаю вакансию перед откликом', file: 'page-log.ts' },
  'apply.open': { do: 'открою вакансию', file: 'queue-run.ts' },
  'apply.skim': { do: 'быстро пролистал', file: 'queue-run.ts' },
  'apply.look': { do: 'читаю вакансию', file: 'queue-run.ts' },
  'apply.send': { do: 'отправлю текст на сервер', file: 'queue-run.ts' },
  'apply.distract': { do: 'пауза после отклика', file: 'queue-run.ts' },
  'apply.pause': { do: 'пауза перед кнопкой', file: 'apply-run.ts' },
  'apply.click': { do: 'нажму Откликнуться', file: 'apply-click.ts' },
  'apply.form': { do: 'жду форму отклика', file: 'apply-run.ts' },
  'apply.fill': { do: 'заполню форму', file: 'apply-fill.ts' },
  'apply.done': { do: 'закончу отклик', file: 'apply-run.ts' },
  'apply.answer': { do: 'жду ответ hh', file: 'apply-run.ts' },
  'search.hunt': { do: 'ищу вакансию в ленте', file: 'hh-search.ts' },
  'search.load': { do: 'жду загрузку страницы hh', file: 'page-load.ts' },
  'search.read': { do: 'читаю карточки на странице', file: 'hh-search.ts' },
  'hide.wait': { do: 'пауза после скрытия', file: 'hh-search.ts' },
  'hide.look': { do: 'проверю, закрылось ли меню', file: 'hide-popup.ts' },
  'cycle.rest': { do: 'пауза между кругами поиска', file: 'queue-run.ts' },
  'server.retry': { do: 'сервер молчит, повтор', file: 'queue-run.ts' },
  'server.send': { do: 'отправлю снова', file: 'queue-run.ts' },
  'tea.break': { do: 'ушёл курить', file: 'tea.ts' },
  'tea.miss': { do: 'перекур не выпал', file: 'tea.ts' },
  'queue.next': { do: 'следующая вакансия', file: 'queue-run.ts' },
  'queue.idle': { do: 'простой', file: 'page-log.ts' },
  'queue.wake': { do: 'продолжу очередь', file: 'page-log.ts' },
};

export function stageLine(mark: WaitMark): string | null {
  if (mark.id === 'queue.idle' || mark.id === 'hide.wait')
    return null;

  const here = PLACE[mark.id];
  const next = PLACE[mark.next];
  const file = here?.file ?? mark.id;
  const doing = here?.do ?? mark.human;
  const after = next?.do ?? mark.next;
  const budget = mark.budget === null ? '' : `, ${mark.budget} с`;

  return `${file} · ${doing}${budget} · потом ${after}`;
}

export function pulseLines(text: string): string[] | null {
  const hit = readWaitPulse(text);
  if (hit === null)
    return null;

  const here = PLACE[hit.id];
  const next = PLACE[hit.next];
  const doing = here?.do ?? hit.human;
  const file = here?.file ?? hit.id;
  const after = next?.do ?? hit.next;
  if (hit.id === 'queue.idle')
    return ['простой, секунды не пишу', 'жду следующую работу', file];

  const clock = hit.budget === null ? `${hit.elapsed} с` : `${hit.elapsed} из ${hit.budget} с`;

  return [doing, clock, `потом: ${after}`, file];
}
