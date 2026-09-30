// Секунды пауз берутся из кода, не из догадки.
// Чтение, быстрое и отвлечение: apps/extension/src/chrome/pace.ts, waitMs и rare.
// Чай: apps/extension/src/chrome/tea.ts, один бросок раз в 45 минут.
// На графике период и промах 15 с идут через sway (±16%). Таймер расширения тот же.
// Отдых круга: apps/extension/src/chrome/queue-run.ts, REST_MIN_SEC / REST_MAX_SEC, один раз в restCycle.
// Паузы перед кликом: apps/extension/src/hh/apply-run.ts, between() в clickOpen и submitStep.
// Потолок дня: apps/hh/src/limits.ts, SEND_PER_DAY.
// «Жду ответ» ждёт страницу и выходит раньше, потолок beat 8 с. В сумму секунд не входит.

export type Pace = {
  readMin: number;
  readMax: number;
  distractMin: number;
  distractMax: number;
  fastEvery: number;
  fastMin: number;
  fastMax: number;
};

export type LaneTone = 'timer' | 'mark' | 'rare' | 'cycle' | 'caption';

export type Lane = {
  label: string;
  tag: string;
  start: number;
  seconds: number;
  note: string;
  tone: LaneTone;
  gap: boolean;
};

export type Figure = {
  title: string;
  value: string;
  line: string;
};

export type Scenario = Figure & {
  seconds: number;
};

export type PacePicture = {
  axisMax: number;
  dayCap: number;
  lanes: Lane[];
  scenarios: Scenario[];
  cap: Figure;
  windows: Figure[];
  hours: Figure[];
  idle: Figure[];
  rest: Figure;
};

const DAY_CAP = 110;
const OPEN_MIN_MS = 700;
const OPEN_MAX_MS = 2_600;
const SEND_MIN_MS = 900;
const SEND_MAX_MS = 3_200;
const REST_MIN_SEC = 0;
const REST_MAX_SEC = 60;
const TWO_HOURS = 2 * 3600;
const EIGHT_HOURS = 8 * 3600;
const SWAY = 0.16;
const TEA_EVERY_MIN = 45;

function sway(base: number, p: number): number {
  return base * (1 + Math.min(SWAY, Math.max(-SWAY, p)));
}

const TEA_MIN_SEC = 300;
const TEA_MAX_SEC = 600;
const TEA_MEAN_SEC = (TEA_MIN_SEC + TEA_MAX_SEC) / 2;
const TEA_MISS_SEC = 15;
const TEA_EXPECT_SEC = (33 * TEA_MEAN_SEC + 67 * TEA_MISS_SEC) / 100;

type TeaKind = 'mid' | 'slow' | 'fast';

const TEA_PERIOD: Record<TeaKind, number> = {
  mid: sway(TEA_EVERY_MIN, 0) * 60,
  slow: sway(TEA_EVERY_MIN, -SWAY) * 60,
  fast: sway(TEA_EVERY_MIN, SWAY) * 60,
};
const DAY_LOW = Math.floor(sway(DAY_CAP, -SWAY));
const DAY_HIGH = Math.ceil(sway(DAY_CAP, SWAY));

type Span = { min: number; max: number; mean: number };
type TeaBill = { rolls: number; added: number; total: number };

export function imitationPicture(pace: Pace): PacePicture {
  const read = spanSec(pace.readMin, pace.readMax);
  const distract = spanSec(pace.distractMin, pace.distractMax);
  const fast = spanSec(pace.fastMin, pace.fastMax);
  const open = spanMs(OPEN_MIN_MS, OPEN_MAX_MS);
  const send = spanMs(SEND_MIN_MS, SEND_MAX_MS);
  const rest = spanSec(REST_MIN_SEC, REST_MAX_SEC);
  const fastEvery = everyOf(pace.fastEvery);
  const pFast = fastEvery > 0 ? 1 / fastEvery : 0;
  const readBranch = pFast < 1;
  const fastBranch = pFast > 0;
  const fastAlways = pFast >= 1;
  const fastSometimes = fastBranch && fastAlways === false;
  const slotMean = (readBranch ? (1 - pFast) * read.mean : 0) + (fastBranch ? pFast * fast.mean : 0);
  const slowSlot = edgeSlot(read, fast, readBranch, fastBranch, 'max');
  const quickSlot = edgeSlot(read, fast, readBranch, fastBranch, 'min');
  const slotName = readBranch ? 'чтение' : 'быстро';
  const perFast = quickSlot + open.min + send.min + distract.min;
  const perMid = slotMean + distract.mean + open.mean + send.mean;
  const slowBody = slowSlot + open.max + send.max + distract.max;
  const teaFast = withTea(DAY_CAP * perFast, TEA_MISS_SEC, TEA_PERIOD.fast);
  const teaMid = withTea(DAY_CAP * perMid, TEA_EXPECT_SEC, TEA_PERIOD.mid);
  const teaSlow = withTea(DAY_CAP * slowBody, TEA_MAX_SEC, TEA_PERIOD.slow);
  const midTerms = [
    readExpect(slotName, read, fast, fastEvery, fastSometimes, fastAlways),
    `отвлечение ${secText(distract.mean)}`,
    `клик ${secText(open.mean)}`,
    `отправка ${secText(send.mean)}`,
  ].filter(term => term.length > 0);
  const fastTerms = termList([
    [slotName, quickSlot],
    ['клик', open.min],
    ['отправка', send.min],
    ['отвлечение', distract.min],
  ]);
  const slowTerms = termList([
    [slotName, slowSlot],
    ['клик', open.max],
    ['отправка', send.max],
    ['отвлечение', distract.max],
  ]);
  const midFormula = joinTerms(midTerms);
  const fastFormula = joinTerms(fastTerms);
  const slowFormula = joinTerms(slowTerms);
  const chainRead = fastAlways ? fast.mean : read.mean;
  const chainLabel = fastAlways ? 'быстро' : 'читаю';
  const chainNote = fastAlways ? rangeNote(fast) : rangeNote(read);
  let cursor = 0;
  const lanes: Lane[] = [
    mark('открыл', 'сразу', '', cursor, false),
    bar(chainLabel, 'таймер', cursor, chainRead, chainNote, 'timer', false),
  ];
  cursor += chainRead;
  lanes.push(bar('жму откликнуться', 'таймер', cursor, open.mean, rangeNote(open), 'timer', false));
  cursor += open.mean;
  lanes.push(bar('отправляю', 'таймер', cursor, send.mean, rangeNote(send), 'timer', false));
  cursor += send.mean;
  lanes.push(mark('жду ответ', 'жду', 'пока страница не подтвердит, потолок 8 с', cursor, false));
  lanes.push(mark('откликнулся', 'сразу', '', cursor, false));
  lanes.push(bar('отвлёкся', 'таймер', cursor, distract.mean, rangeNote(distract), 'timer', false));
  if (fastSometimes)
    lanes.push(bar('быстро', 'иногда', 0, fast.mean, `1 из ${fastEvery}, ${rangeNote(fast)}, вместо чтения`, 'rare', true));

  lanes.push(bar('чай', '45 мин ±16%', 0, TEA_EXPECT_SEC, teaCaption(), 'caption', true));
  lanes.push(bar('между кругами', 'отдельно', 0, rest.mean, `${rangeNote(rest)}, один раз на круг`, 'cycle', true));

  const longest = Math.max(
    cursor + distract.mean,
    TEA_EXPECT_SEC,
    rest.max,
    slowBody,
    perMid,
    perFast,
  );

  return {
    axisMax: axisOf(longest),
    dayCap: DAY_CAP,
    lanes,
    scenarios: [
      scenario('Средний', perMid, `${midFormula} с`),
      scenario('Худший', slowBody, `${slowFormula} с`),
      scenario('Самый быстрый', perFast, `${fastFormula} с`),
    ],
    cap: figure(
      'Потолок дня',
      `от ${DAY_LOW} до ${DAY_HIGH}`,
      `в день не ровно ${DAY_CAP}, а от ${DAY_LOW} до ${DAY_HIGH} (±16%). ${DAY_CAP} × ${secText(sway(1, -SWAY))} = ${secText(sway(DAY_CAP, -SWAY))} → ${DAY_LOW}. ${DAY_CAP} × ${secText(sway(1, SWAY))} = ${secText(sway(DAY_CAP, SWAY))} → ${DAY_HIGH}. Середина ${DAY_CAP}.`,
    ),
    windows: [
      windowFigure(2, TWO_HOURS, perMid, perFast, slowBody, midFormula, fastFormula, slowFormula),
      windowFigure(8, EIGHT_HOURS, perMid, perFast, slowBody, midFormula, fastFormula, slowFormula),
    ],
    hours: [
      figure('Самый быстрый', clockOf(teaFast.total), hourLine(fastFormula, DAY_CAP * perFast, teaFast, 'fast')),
      figure('Ожидается', clockOf(teaMid.total), hourLine(midFormula, DAY_CAP * perMid, teaMid, 'mid')),
      figure('Худший', clockOf(teaSlow.total), hourLine(slowFormula, DAY_CAP * slowBody, teaSlow, 'slow')),
      edgeHours(DAY_LOW, perMid, -SWAY),
      edgeHours(DAY_HIGH, perMid, SWAY),
    ],
    idle: [
      figure('Сумма', 'та же, что часы выше', 'Простой на 110 — те же секунды, что в «Часов требуется».'),
    ],
    rest: figure(
      'Отдых между кругами',
      rangeNote(rest),
      `среднее ${secText(rest.mean)} с, один раз на круг, не × ${DAY_CAP}: сколько откликов за круг код не задаёт`,
    ),
  };
}

function windowFigure(
  hours: number,
  budget: number,
  perMid: number,
  perFast: number,
  slowBody: number,
  midFormula: string,
  fastFormula: string,
  slowFormula: string,
): Figure {
  const mid = fitVacancies(budget, perMid, TEA_EXPECT_SEC, TEA_PERIOD.mid);
  const quick = fitVacancies(budget, perFast, TEA_MISS_SEC, TEA_PERIOD.fast);
  const slow = fitVacancies(budget, slowBody, TEA_MAX_SEC, TEA_PERIOD.slow);
  const low = Math.min(quick, slow, mid);
  const high = Math.max(quick, slow, mid);
  const value = low !== high ? `от ${low} до ${high}, в среднем ${mid}` : `${mid}`;
  const line = [
    budgetLine('средний', midFormula, perMid, mid, 'mid'),
    budgetLine('быстрый', fastFormula, perFast, quick, 'fast'),
    budgetLine('худший', slowFormula, slowBody, slow, 'slow'),
  ].join(' ');

  return figure(`За ${hours} ч без потолка`, value, line);
}

function budgetLine(name: string, formula: string, per: number, count: number, kind: TeaKind): string {
  const bill = withTea(count * per, teaCost(kind), TEA_PERIOD[kind]);

  return `${name}: ${count} × (${formula}) с = ${secText(count * per)} с. ${teaArithmetic(bill, kind)} Вместе ${secText(bill.total)} с.`;
}

function hourLine(formula: string, base: number, roll: TeaBill, kind: TeaKind): string {
  return `${DAY_CAP} × (${formula}) с = ${secText(base)} с. ${teaArithmetic(roll, kind)} Вместе ${secText(roll.total)} с.`;
}

function edgeHours(count: number, per: number, p: number): Figure {
  const bill = withTea(count * per, TEA_EXPECT_SEC, TEA_PERIOD.mid);

  return figure(
    `На ${count}`,
    clockOf(bill.total),
    `${DAY_CAP} × ${secText(sway(1, p))} = ${secText(sway(DAY_CAP, p))} → ${count}. Ожидаемый темп, период 45 мин, чай ${bill.rolls} × ${secText(TEA_EXPECT_SEC)} с.`,
  );
}

function teaArithmetic(roll: TeaBill, kind: TeaKind): string {
  const lines: Record<TeaKind, string> = {
    mid: `Чай: ${roll.rolls} × (0.33×${secText(TEA_MEAN_SEC)} + 0.67×${TEA_MISS_SEC}) с = ${secText(roll.added)} с, ${periodNote('mid')}. ${missNote()}.`,
    slow: `Чай: ${roll.rolls} × ${secText(TEA_MAX_SEC)} с = ${secText(roll.added)} с, ${periodNote('slow')}.`,
    fast: `Чай: ${roll.rolls} × ${TEA_MISS_SEC} с = ${secText(roll.added)} с, ${periodNote('fast')}. ${missNote()}.`,
  };

  return lines[kind];
}

function periodNote(kind: TeaKind): string {
  const low = secText(sway(TEA_EVERY_MIN, -SWAY));
  const high = secText(sway(TEA_EVERY_MIN, SWAY));
  const notes: Record<TeaKind, string> = {
    mid: `период ${TEA_EVERY_MIN} мин ±16% (${low}–${high}), в среднем ${TEA_EVERY_MIN} мин`,
    slow: `период ${low} мин (${TEA_EVERY_MIN} × ${secText(sway(1, -SWAY))})`,
    fast: `период ${high} мин (${TEA_EVERY_MIN} × ${secText(sway(1, SWAY))})`,
  };

  return notes[kind];
}

function missNote(): string {
  const low = secText(sway(TEA_MISS_SEC, -SWAY));
  const high = secText(sway(TEA_MISS_SEC, SWAY));

  return `${TEA_MISS_SEC} с ±16% (${low}–${high}), в среднем ${TEA_MISS_SEC} с`;
}

function teaCaption(): string {
  const low = secText(sway(TEA_EVERY_MIN, -SWAY));
  const high = secText(sway(TEA_EVERY_MIN, SWAY));

  return `период чая ${TEA_EVERY_MIN} мин ±16%: ${low}–${high} мин. шанс 33%: чай 5–10 мин, иначе ${missNote()}`;
}

function teaCost(kind: TeaKind): number {
  const cost: Record<TeaKind, number> = { mid: TEA_EXPECT_SEC, slow: TEA_MAX_SEC, fast: TEA_MISS_SEC };

  return cost[kind];
}

function withTea(base: number, each: number, every: number): TeaBill {
  let total = base;
  let rolls = 0;
  for (let step = 0; step < 32; step += 1) {
    rolls = every > 0 ? Math.floor(total / every) : 0;
    const next = base + rolls * each;
    if (Math.abs(next - total) < 1e-6) {
      total = next;

      break;
    }

    total = next;
  }

  return { rolls, added: rolls * each, total };
}

function fitVacancies(budget: number, per: number, each: number, every: number): number {
  if (Number.isFinite(per) === false || per <= 0)
    return 0;

  let count = Math.floor(budget / per);
  while (count > 0 && withTea(count * per, each, every).total > budget + 1e-6)
    count -= 1;

  return count;
}

function edgeSlot(read: Span, fast: Span, readOn: boolean, fastOn: boolean, edge: 'min' | 'max'): number {
  const span = readOn ? read : fastOn ? fast : null;
  if (span === null)
    return 0;

  return span[edge];
}

function readExpect(name: string, read: Span, fast: Span, quota: number, sometimes: boolean, always: boolean): string {
  if (always)
    return `${name} ${secText(fast.mean)}`;

  if (sometimes)
    return `${name} ((${quota - 1}/${quota})×${secText(read.mean)} + (1/${quota})×${secText(fast.mean)})`;

  return `${name} ${secText(read.mean)}`;
}

function termList(parts: Array<[string, number]>): string[] {
  return parts.filter(([, value]) => value > 0).map(([name, value]) => `${name} ${secText(value)}`);
}

function joinTerms(terms: string[]): string {
  return terms.length > 0 ? terms.join(' + ') : '0';
}

function bar(label: string, tag: string, start: number, seconds: number, note: string, tone: LaneTone, gap: boolean): Lane {
  return { label, tag, start, seconds, note, tone, gap };
}

function mark(label: string, tag: string, note: string, start: number, gap: boolean): Lane {
  return { label, tag, start, seconds: 0, note, tone: 'mark', gap };
}

function figure(title: string, value: string, line: string): Figure {
  return { title, value, line };
}

function scenario(title: string, seconds: number, line: string): Scenario {
  return { title, value: `${secText(seconds)} с`, line, seconds };
}

function rangeNote(span: Span): string {
  if (span.min === span.max)
    return `${secText(span.min)} с`;

  return `${secText(span.min)}–${secText(span.max)} с`;
}

function spanSec(min: number, max: number): Span {
  return spanMs(finite(min) * 1000, finite(max) * 1000);
}

function spanMs(minMs: number, maxMs: number): Span {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  const mean = (lo + hi) / 2;

  return { min: meanToSec(lo), max: meanToSec(hi), mean: meanToSec(mean) };
}

function meanToSec(ms: number): number {
  return ms / 1000;
}

function everyOf(value: number): number {
  const quota = Math.floor(finite(value));
  if (quota < 1)
    return 0;

  return quota;
}

function finite(value: number): number {
  if (typeof value !== 'number' || Number.isFinite(value) === false)
    return 0;

  return value < 0 ? 0 : value;
}

function axisOf(seconds: number): number {
  const need = Math.max(seconds, 10);
  const steps = [15, 30, 60, 90, 120, 180, 240, 300, 600, 900, 1200, 1800];
  const hit = steps.find(step => step >= need);

  return hit ?? Math.ceil(need / 600) * 600;
}

function secText(value: number): string {
  const text = (Math.round(value * 1000) / 1000).toFixed(3);

  return text.replace(/0+$/, '').replace(/\.$/, '');
}

function clockOf(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const parts = [
    hours > 0 ? `${hours} ч` : '',
    minutes > 0 ? `${minutes} мин` : '',
    rest > 0 ? `${rest} с` : '',
  ].filter(part => part.length > 0);

  return parts.length > 0 ? parts.join(' ') : '0 с';
}
