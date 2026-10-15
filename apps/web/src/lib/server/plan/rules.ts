// Pure rules ported from apps/extension (pace.ts, tea.ts, queue-run.ts hoursOpen/titleStop, detect-wall, negotiations).
// No timers, no storage: callers pass now/rand, so every decision is testable.
export type Rand = () => number;

export interface Pace { readMin: number; readMax: number; distractMin: number; distractMax: number; fastEvery: number; fastMin: number; fastMax: number }
export const PACE_DEFAULT: Pace = { readMin: 10, readMax: 40, distractMin: 5, distractMax: 55, fastEvery: 12, fastMin: 1, fastMax: 4 };

export function paceOf(raw: unknown): Pace {
  const row = typeof raw === 'object' && raw !== null ? raw as Partial<Pace> : {};
  const pace: Pace = { ...PACE_DEFAULT };
  const whole = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
  for (const [a, b] of [['readMin', 'readMax'], ['distractMin', 'distractMax'], ['fastMin', 'fastMax']] as const) {
    const lo = whole(row[a], 0, 600);
    const hi = whole(row[b], 0, 600);
    if (lo !== null && hi !== null && lo <= hi) { pace[a] = lo; pace[b] = hi; }
  }
  const every = whole(row.fastEvery, 1, 100);
  if (every !== null)
    pace.fastEvery = every;
  return pace;
}

export function waitMs(min: number, max: number, rand: Rand): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return (lo + Math.floor(rand() * (hi - lo + 1))) * 1000;
}

// queue-run.ts pacedWait: rare fast skim, otherwise "reading".
export function readWait(pace: Pace, rand: Rand): { ms: number; fast: boolean } {
  const fast = pace.fastEvery >= 1 && Math.floor(rand() * pace.fastEvery) === 0;
  return { ms: fast ? waitMs(pace.fastMin, pace.fastMax, rand) : waitMs(pace.readMin, pace.readMax, rand), fast };
}

export const distractWait = (pace: Pace, rand: Rand) => waitMs(pace.distractMin, pace.distractMax, rand);

// tea.ts: 33% hit → 300..600 s break; miss → ~15 s sway (±16%).
export const TEA = { hit: 0.33, minSec: 300, maxSec: 600, missMs: 15_000, sway: 0.16, everyMs: 45 * 60_000 };
export function teaRoll(rand: Rand): { hit: boolean; ms: number } {
  const hit = rand() < TEA.hit;
  if (hit)
    return { hit, ms: waitMs(TEA.minSec, TEA.maxSec, rand) };
  return { hit, ms: Math.round(TEA.missMs * (1 - TEA.sway + rand() * 2 * TEA.sway)) };
}

// queue-run.ts hoursOpen: 09..22 Moscow time.
export const HOURS = { from: 9, to: 22, tz: 'Europe/Moscow' };
export function mskHour(now: number): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: HOURS.tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)));
}
export function hoursOpen(now: number, keep: boolean): boolean {
  if (keep === false)
    return true;
  const h = mskHour(now);
  return h >= HOURS.from && h < HOURS.to;
}
// ms until next 09:00 MSK (MSK = UTC+3, no DST).
export function msToOpen(now: number): number {
  const d = new Date(now + 3 * 3600_000);
  const open = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), HOURS.from) - 3 * 3600_000;
  return open > now ? open - now : open + 86_400_000 - now;
}

const TITLE_STOP = /(?:^|[^\p{L}\p{N}])(php|bitrix|битрикс|1с|1c|react\s*native|angular|ангуляр)(?=$|[^\p{L}\p{N}])/iu;
export function titleStop(title: string): string {
  const m = title.match(TITLE_STOP);
  return m ? `стоп-слово в названии: ${m[1]}` : '';
}

// Page signals. The extension only reports page text/url; the decision is here.
export const DETECT_WALL = 'Вам недоступна эта вакансия';
const CAPTCHA = /captcha|капч|подтвердите, что вы не робот|smart-?captcha/i;
const LIMIT = /максимум вакансий|лимит откликов|слишком много откликов/i;
export type Signal = 'captcha' | 'detect' | 'login' | 'limit' | null;
export function pageSignal(page: { url?: string; text?: string; captcha?: boolean; detect?: boolean }): Signal {
  const url = page.url ?? '';
  const text = page.text ?? '';
  if (page.captcha === true || CAPTCHA.test(url) || CAPTCHA.test(text.slice(0, 20_000)))
    return 'captcha';
  if (page.detect === true || text.includes(DETECT_WALL))
    return 'detect';
  if (url.includes('/account/login') || text.includes('data-qa="account-login"'))
    return 'login';
  if (LIMIT.test(text))
    return 'limit';
  return null;
}

export const NEGOTIATIONS = { url: 'https://hh.ru/applicant/negotiations?state=all', everyMs: 60 * 60_000 };
export const negotiationsDue = (now: number, last: number) => now - last >= NEGOTIATIONS.everyMs;

// search/feed-dry.ts + queue-run light mode.
export const FEED_DRY_STOP = 3;
export const LIGHT_BATCH = 10;
export const LIGHT_SLEEP_MS = 60 * 60_000;
const JUNK_ROLE = /(?:^|[^\p{L}\p{N}])(?:менеджер|manager|курьер|водител|риелтор|риэлтор|недвижимост|мерчендайзер|колл-?центр|коллцентр|call-?центр|контактн\p{L}* центр|кассир|продав|кладовщик|грузчик|комплектовщик|промоутер)/iu;
const STACK = /(?:^|[^\p{L}\p{N}])(?:frontend|front-end|front\s*end|фронтенд|фронтэнд|vue|react|typescript|javascript|node(?:\.?js)?|nest(?:\.?js)?|graphql|fullstack|full-stack|full\s*stack|фул+ст[еэ]к)(?=$|[^\p{L}\p{N}])/iu;
export function feedDry(title: string, text: string): boolean {
  return JUNK_ROLE.test(title) || STACK.test(`${title}\n${text}`) === false;
}
