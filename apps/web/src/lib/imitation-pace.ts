// Секунды пауз берутся из кода, не из догадки.
// Чтение, чай, быстрое и отвлечение: apps/extension/src/chrome/pace.ts, waitMs и rare.
// Отдых круга: apps/extension/src/chrome/queue-run.ts, REST_MIN_SEC / REST_MAX_SEC, один раз в restCycle.
// Паузы перед кликом: apps/extension/src/hh/apply-run.ts, between() в clickOpen и submitStep.
// Потолок дня: apps/hh/src/limits.ts, SEND_PER_DAY.
// «Жду ответ» ждёт страницу и выходит раньше, потолок beat 8 с. В сумму секунд не входит.

export type Pace = {
  readMin: number;
  readMax: number;
  distractMin: number;
  distractMax: number;
  teaEvery: number;
  teaMin: number;
  teaMax: number;
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
const REST_MIN_SEC = 10;
const REST_MAX_SEC = 50;
const TWO_HOURS = 2 * 3600;
const EIGHT_HOURS = 8 * 3600;

type Span = { min: number; max: number; mean: number };

export function imitationPicture(pace: Pace): PacePicture {
  const read = spanSec(pace.readMin, pace.readMax);
  const distract = spanSec(pace.distractMin, pace.distractMax);
  const tea = spanSec(pace.teaMin, pace.teaMax);
  const fast = spanSec(pace.fastMin, pace.fastMax);
  const open = spanMs(OPEN_MIN_MS, OPEN_MAX_MS);
  const send = spanMs(SEND_MIN_MS, SEND_MAX_MS);
  const rest = spanSec(REST_MIN_SEC, REST_MAX_SEC);
  const teaEvery = everyOf(pace.teaEvery);
  const fastEvery = everyOf(pace.fastEvery);
  const pTea = teaEvery > 0 ? 1 / teaEvery : 0;
  const pFast = fastEvery > 0 ? 1 / fastEvery : 0;
  const readBranch = pFast < 1;
  const fastBranch = pFast > 0;
  const teaAlways = pTea >= 1;
  const teaSometimes = pTea > 0 && teaAlways === false;
  const fastAlways = pFast >= 1;
  const fastSometimes = fastBranch && fastAlways === false;
  const slotMean = (readBranch ? (1 - pFast) * read.mean : 0) + (fastBranch ? pFast * fast.mean : 0);
  const teaMean = pTea * tea.mean;
  const slowSlot = slower(read, fast, readBranch, fastBranch);
  const quickSlot = quicker(read, fast, readBranch, fastBranch);
  const teaOnFast = teaAlways ? tea.min : 0;
  const perFast = quickSlot + open.min + send.min + distract.min + teaOnFast;
  const perMid = slotMean + teaMean + distract.mean + open.mean + send.mean;
  const perSlow = slowSlot + open.max + send.max + distract.max + (teaEvery > 0 ? tea.max / teaEvery : 0);
  const slowBody = slowSlot + open.max + send.max + distract.max;
  const teaHits = teaEvery > 0 ? Math.floor(DAY_CAP / teaEvery) : 0;
  const idleFast = DAY_CAP * perFast;
  const idleMid = DAY_CAP * perMid;
  const idleSlow = DAY_CAP * slowBody + teaHits * tea.max;
  const chainRead = fastAlways ? fast.mean : read.mean;
  const chainLabel = fastAlways ? 'быстро' : 'читаю';
  const chainNote = fastAlways ? rangeNote(fast) : rangeNote(read);
  let cursor = 0;
  const lanes: Lane[] = [
    mark('открыл', 'сразу', '', cursor, false),
  ];
  if (teaAlways) {
    lanes.push(bar('чай', 'таймер', cursor, tea.mean, rangeNote(tea), 'timer', false));
    cursor += tea.mean;
  }
  lanes.push(bar(chainLabel, 'таймер', cursor, chainRead, chainNote, 'timer', false));
  cursor += chainRead;
  lanes.push(bar('жму откликнуться', 'таймер', cursor, open.mean, rangeNote(open), 'timer', false));
  cursor += open.mean;
  lanes.push(bar('отправляю', 'таймер', cursor, send.mean, rangeNote(send), 'timer', false));
  cursor += send.mean;
  lanes.push(mark('жду ответ', 'жду', 'пока страница не подтвердит, потолок 8 с', cursor, false));
  lanes.push(mark('откликнулся', 'сразу', '', cursor, false));
  lanes.push(bar('отвлёкся', 'таймер', cursor, distract.mean, rangeNote(distract), 'timer', false));
  if (teaSometimes)
    lanes.push(bar('чай', 'иногда', 0, tea.mean, `1 из ${teaEvery}, ${rangeNote(tea)}, до чтения`, 'rare', true));
  if (fastSometimes)
    lanes.push(bar('быстро', 'иногда', 0, fast.mean, `1 из ${fastEvery}, ${rangeNote(fast)}, вместо чтения`, 'rare', lanes.some(lane => lane.tone === 'rare') === false));
  lanes.push(bar('между кругами', 'отдельно', 0, rest.mean, `${rangeNote(rest)}, один раз на круг`, 'cycle', true));

  const longest = Math.max(
    cursor + distract.mean,
    tea.max,
    rest.max,
    perSlow,
    perMid,
    perFast,
  );

  return {
    axisMax: axisOf(longest),
    dayCap: DAY_CAP,
    lanes,
    scenarios: [
      scenario('Средний', perMid, partsLine([
        ['чтение', slotMean],
        ['чай', teaMean],
        ['отвлечение', distract.mean],
        ['клик', open.mean],
        ['отправка', send.mean],
      ])),
      scenario('Худший', perSlow, slowPaceLine(slowBody, tea.max, teaEvery)),
      scenario('Самый быстрый', perFast, partsLine([
        [quickSlot === fast.min && fastBranch ? 'быстро' : 'чтение', quickSlot],
        ['клик', open.min],
        ['отправка', send.min],
        ['отвлечение', distract.min],
        ['чай', teaOnFast],
      ])),
    ],
    cap: figure('Потолок дня', `${DAY_CAP} в день`, 'лимит откликов за день'),
    windows: [
      windowFigure(2, TWO_HOURS, perMid, perFast, slowBody, teaEvery, tea.max),
      windowFigure(8, EIGHT_HOURS, perMid, perFast, slowBody, teaEvery, tea.max),
    ],
    hours: [
      figure('Самый быстрый', clockOf(idleFast), `${DAY_CAP} × ${secText(perFast)} с = ${secText(idleFast)} с`),
      figure('Ожидается', clockOf(idleMid), `${DAY_CAP} × ${secText(perMid)} с = ${secText(idleMid)} с`),
      figure('Худший', clockOf(idleSlow), `${DAY_CAP} × ${secText(slowBody)} с + ${teaHits} × ${secText(tea.max)} с = ${secText(idleSlow)} с`),
    ],
    idle: [
      figure('В среднем', clockOf(idleMid), `${DAY_CAP} × (${namedSum([
        ['чтение', slotMean],
        ['чай', teaMean],
        ['отвлечение', distract.mean],
        ['клик', open.mean],
        ['отправка', send.mean],
      ])}) с = ${secText(idleMid)} с`),
      figure('Худший', clockOf(idleSlow), `${DAY_CAP} × ${secText(slowBody)} с + ${teaHits} × ${secText(tea.max)} с чая = ${secText(idleSlow)} с`),
      figure('Самый быстрый', clockOf(idleFast), teaOnFast > 0
        ? `${DAY_CAP} × ${secText(perFast)} с = ${secText(idleFast)} с`
        : `${DAY_CAP} × ${secText(perFast)} с = ${secText(idleFast)} с, без чая`),
    ],
    rest: figure(
      'Отдых между кругами',
      rangeNote(rest),
      `среднее ${secText(rest.mean)} с, один раз на круг, не × ${DAY_CAP}: сколько откликов за круг код не задаёт`,
    ),
  };
}

function windowFigure(hours: number, budget: number, perMid: number, perFast: number, slowBody: number, teaEvery: number, teaMax: number): Figure {
  const mid = wholeVacancies(budget, perMid, 0, 0);
  const quick = wholeVacancies(budget, perFast, 0, 0);
  const slow = wholeVacancies(budget, slowBody, teaEvery, teaMax);
  const low = Math.min(quick, slow, mid);
  const high = Math.max(quick, slow, mid);
  const spread = low !== high;
  const value = spread
    ? `от ${low} до ${high}, в среднем ${mid}`
    : `${mid}`;

  return figure(
    `За ${hours} ч без потолка`,
    value,
    `${budget} с / ${secText(perMid)} с → ${mid}; быстрый ${quick}; худший ${slow}`,
  );
}

function wholeVacancies(budget: number, per: number, teaEvery: number, teaAdd: number): number {
  if (Number.isFinite(per) === false || per <= 0)
    return 0;

  let count = Math.floor(budget / per);
  while (count > 0 && count * per + teaExtra(count, teaEvery, teaAdd) > budget + 1e-6)
    count -= 1;

  return count;
}

function teaExtra(count: number, every: number, add: number): number {
  if (every < 1 || add <= 0)
    return 0;

  return Math.floor(count / every) * add;
}

function slower(read: Span, fast: Span, readOn: boolean, fastOn: boolean): number {
  return Math.max(readOn ? read.max : 0, fastOn ? fast.max : 0);
}

function quicker(read: Span, fast: Span, readOn: boolean, fastOn: boolean): number {
  const picks = [readOn ? read.min : Number.POSITIVE_INFINITY, fastOn ? fast.min : Number.POSITIVE_INFINITY];
  const best = Math.min(...picks);

  return best === Number.POSITIVE_INFINITY ? 0 : best;
}

function slowPaceLine(body: number, teaMax: number, every: number): string {
  if (every < 1)
    return `${secText(body)} с, без чая`;

  return `${secText(body)} с + ${secText(teaMax)} / ${every} с чая`;
}

function namedSum(parts: Array<[string, number]>): string {
  const shown = parts.filter(([, value]) => value > 0);
  if (shown.length === 0)
    return '0';

  return shown.map(([name, value]) => `${name} ${secText(value)}`).join(' + ');
}

function partsLine(parts: Array<[string, number]>): string {
  const shown = parts.filter(([, value]) => value > 0);
  if (shown.length === 0)
    return '0 с';

  return `${shown.map(([name, value]) => `${name} ${secText(value)}`).join(' + ')} с`;
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
  const every = Math.floor(finite(value));
  if (every < 1)
    return 0;

  return every;
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
