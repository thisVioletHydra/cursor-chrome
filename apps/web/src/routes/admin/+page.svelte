<script lang="ts">
import { enhance } from '$app/forms';
import { onMount, tick } from 'svelte';
import { logKey, logPlace, logSnap, readLog, takeRows } from './log-snap.svelte.ts';

let { data } = $props();
let stats = $state(data.stats);
let polling = $state(data.polling);
let watchList: HTMLUListElement | undefined;
let placing = false;
let alive = false;
let seenView = 0;
let restarting = $state(false);
let restartNote = $state('');
let restartOk = $state(false);
let hoursOn = $state(data.hours !== false);
let hoursSaving = $state(false);
let hoursNote = $state('');
let hoursOk = $state(false);
let liveBusy = $state(false);
let liveNote = $state('');
const COPY_LABEL = 'Скопировать';
let copyNote = $state(COPY_LABEL);
let copyTone = $state<'idle' | 'ok' | 'fail'>('idle');
let copyTimer: ReturnType<typeof setTimeout> | undefined;
let now = $state(Date.now());
let board = $state<'accepted' | 'hidden' | 'waiting'>('accepted');
let dropping = $state(false);
let waitNote = $state('');
let waitOk = $state(false);

const copyClass = $derived(
  copyTone === 'ok'
    ? 'border-emerald-400/50 text-emerald-300'
    : copyTone === 'fail'
      ? 'border-rose-400/50 text-rose-300'
      : 'border-white/15 text-zinc-100',
);

const whoName: Record<string, string> = {
  extension: 'расширение',
  telegram: 'телега',
  server: 'сервер',
  model: 'модель',
};

$effect(() => {
  stats = data.stats;
  polling = data.polling;
});

$effect(() => {
  hoursOn = data.hours !== false;
});

onMount(() => {
  alive = true;
  const mine = ++seenView;
  const timer = setInterval(() => {
    void refresh(mine);
  }, 4_000);
  const clock = setInterval(() => {
    now = Date.now();
  }, 1_000);
  void refresh(mine);

  return () => {
    alive = false;
    clearInterval(timer);
    clearInterval(clock);
  };
});

async function refresh(mine: number): Promise<void> {
  const res = await fetch('/admin/live').catch(() => null);
  if (mine !== seenView || res === null || res.ok === false)
    return;

  const body = await res.json() as {
    polling?: boolean;
    figures?: { today: number; queued: number; waiting: number; accepted?: number; stale?: number; passedTotal?: number; invitations: number; discards: number; waitingReply: number; hidden: number };
    rows?: typeof stats.rows;
    passed?: typeof stats.passed;
    autopilot?: { auto: boolean; lastNote: string; runAt: number };
    judged?: number;
    pulse?: { line?: string };
    log?: unknown;
  };
  if (mine !== seenView)
    return;

  if (alive) {
    if (body.figures)
      stats = { ...stats, ...body.figures, rows: body.rows ?? stats.rows, passed: body.passed ?? stats.passed, judged: body.judged ?? stats.judged, autopilot: body.autopilot ?? stats.autopilot };

    polling = body.polling === true;
  }

  notePulse(typeof body.pulse?.line === 'string' ? body.pulse.line : '');
  const applied = takeRows(readLog(body.log));
  if (alive === false || mine !== seenView || applied.changed === false)
    return;

  const list = watchList;
  const mark = list !== undefined && logPlace.follow === false
    ? holdLine(list)
    : null;

  await tick();
  if (mine !== seenView)
    return;

  const nextList = watchList;
  if (nextList === undefined)
    return;

  if (logPlace.follow) {
    nextList.scrollTop = 0;
    return;
  }

  if (mark !== null)
    stickLine(nextList, mark);
}

const STEP_MAX = 80;
const STEP_PREFIX = /^(открыл|ищу|читаю|в очереди|в список|мимо,|сервер|админка|жду|уже видели)/;
const HARD_SKIP = /^(удалёнку запрещают|удаленку запрещают|джуниор|1C или Bitrix ядром|Python основной бэк)$/i;
const SKIP_ESSAY = /вакансия требует|стек не сов|скип,|удал[её]нку запрещают|не наш стек/i;

function notePulse(line: string): void {
  if (headerStep(line))
    logSnap.pulse = line.trim();
}

function headerStep(line: string): boolean {
  const text = line.trim();
  if (text.length === 0 || text.length > STEP_MAX)
    return false;

  return skipEssay(text) === false;
}

function skipEssay(text: string): boolean {
  if (STEP_PREFIX.test(text))
    return false;

  if (HARD_SKIP.test(text))
    return true;

  return SKIP_ESSAY.test(text);
}

const liveStep = $derived.by(() => {
  if (headerStep(logSnap.pulse))
    return logSnap.pulse;

  const rows = logSnap.rows;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row !== undefined && row.death === false && headerStep(row.text))
      return row.text;
  }

  return '';
});

const journalRows = $derived([...logSnap.rows].reverse());

const HOUR_MS = 60 * 60 * 1000;

function runMeter(auto: boolean, runAt: number, at: number): { pct: number; label: string; lap: string } {
  if (auto === false || runAt <= 0 || at < runAt)
    return { pct: 0, label: '', lap: '' };

  const elapsed = at - runAt;
  const hour = Math.floor(elapsed / HOUR_MS);

  return {
    pct: (elapsed % HOUR_MS) / HOUR_MS * 100,
    label: runText(elapsed),
    lap: hour < 1 ? '' : `x${hour + 1}`,
  };
}

function runText(elapsed: number): string {
  const total = Math.floor(elapsed / 60_000);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours < 1)
    return `${mins} мин`;

  if (mins === 0)
    return `${hours} ч`;

  return `${hours} ч ${mins} мин`;
}

const run = $derived(runMeter(stats.autopilot.auto === true, stats.autopilot.runAt ?? 0, now));

function clock(at: number): string {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(at);
}

function flashCopy(note: string, tone: 'ok' | 'fail'): void {
  copyNote = note;
  copyTone = tone;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copyNote = COPY_LABEL;
    copyTone = 'idle';
    copyTimer = undefined;
  }, 2000);
}

function shownJournal(): string {
  const list = watchList;
  if (list === undefined)
    return '';

  const box = list.getBoundingClientRect();
  const lines: string[] = [];
  for (const item of list.querySelectorAll<HTMLLIElement>(':scope > li')) {
    const rect = item.getBoundingClientRect();
    if (rect.height === 0 || rect.bottom <= box.top || rect.top >= box.bottom)
      continue;

    const time = item.querySelector('time')?.textContent?.trim() ?? '';
    const bits = item.querySelectorAll('span');
    const who = bits[0]?.textContent?.trim() ?? '';
    const text = bits[1]?.textContent?.trim() ?? '';
    const line = [time, who, text].filter(part => part.length > 0).join(' ');
    if (line.length > 0)
      lines.push(line);
  }

  return lines.join('\n');
}

async function copyJournal(): Promise<void> {
  const text = shownJournal();
  if (text.length === 0) {
    flashCopy('в журнале пусто', 'fail');

    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    flashCopy('Скопировано', 'ok');
  }
  catch (error) {
    const message = error instanceof Error ? error.message : '';
    flashCopy(message.length > 0 ? message : 'не скопировалось', 'fail');
  }
}

function onLogScroll(): void {
  if (watchList === undefined || placing)
    return;

  rememberLog(watchList);
}

function nearTop(node: HTMLElement): boolean {
  return node.scrollTop < 8;
}

function rememberLog(node: HTMLUListElement): void {
  logPlace.scrollTop = node.scrollTop;
  logPlace.follow = nearTop(node);
  const mark = holdLine(node);
  if (mark === null)
    return;

  logPlace.anchorKey = mark.key;
  logPlace.anchorDelta = mark.delta;
}

function placeLog(node: HTMLUListElement): void {
  if (logPlace.follow) {
    node.scrollTop = 0;
    return;
  }

  if (logPlace.anchorKey.length > 0) {
    const item = node.querySelector<HTMLElement>(`:scope > li[data-k="${CSS.escape(logPlace.anchorKey)}"]`);
    if (item !== null) {
      const box = node.getBoundingClientRect();
      const top = item.getBoundingClientRect().top;
      node.scrollTop += top - box.top - logPlace.anchorDelta;
      return;
    }
  }

  node.scrollTop = logPlace.scrollTop;
}

function keepLog(node: HTMLUListElement): { destroy: () => void } {
  watchList = node;
  placing = true;
  placeLog(node);
  void tick().then(() => {
    if (watchList !== node)
      return;

    placeLog(node);
    placing = false;
  });

  return {
    destroy() {
      if (placing === false)
        rememberLog(node);

      if (watchList === node)
        watchList = undefined;
    },
  };
}

function holdLine(list: HTMLUListElement): { key: string; delta: number } | null {
  const box = list.getBoundingClientRect();
  const items = list.querySelectorAll<HTMLElement>(':scope > li[data-k]');
  for (const item of items) {
    const top = item.getBoundingClientRect().top;
    if (top + 1 < box.top)
      continue;

    const key = item.dataset.k;
    if (key === undefined || key.length === 0)
      return null;

    return { key, delta: top - box.top };
  }

  return null;
}

function stickLine(list: HTMLUListElement, mark: { key: string; delta: number }): void {
  if (logPlace.follow)
    return;

  const item = list.querySelector<HTMLElement>(`:scope > li[data-k="${CSS.escape(mark.key)}"]`);
  if (item === null)
    return;

  const box = list.getBoundingClientRect();
  const top = item.getBoundingClientRect().top;
  list.scrollTop += top - box.top - mark.delta;
}

$effect(() => {
  const rows = logSnap.rows;
  const headAt = rows[0]?.at ?? 0;
  const tailAt = rows[rows.length - 1]?.at ?? 0;
  if (logPlace.follow === false || rows.length === 0)
    return;

  void (headAt + tailAt);

  void tick().then(() => {
    if (watchList === undefined || logPlace.follow === false)
      return;

    watchList.scrollTop = 0;
  });
});

const cards = $derived([
  { href: '/admin/telegram', light: data.links.find(item => item.name === 'Телега') },
  { href: '/admin/model', light: data.links.find(item => item.name === 'Модель') },
  { href: '/admin/hh', light: data.links.find(item => item.name === 'HeadHunter') },
].flatMap(card => (card.light ? [{ href: card.href, light: card.light }] : [])));

const figures = $derived([
  { label: 'Сегодня', value: stats.today },
  { label: 'В очереди', value: stats.queued },
  { label: 'Ждут тебя', value: stats.waiting },
  { label: 'Приглашения', value: stats.invitations },
  { label: 'Отказы', value: stats.discards },
  { label: 'Скрытые', value: stats.hidden },
]);

function showBoard(next: 'accepted' | 'hidden' | 'waiting'): void {
  board = next;
}

function dropDetail(data: unknown): { ok: boolean; detail: string; ids: string[] } {
  if (typeof data !== 'object' || data === null)
    return { ok: false, detail: 'не вышло', ids: [] };

  const detail = 'detail' in data && typeof data.detail === 'string' && data.detail.length > 0 ? data.detail : 'не вышло';
  const ok = 'ok' in data && data.ok === true;
  const ids = 'ids' in data && Array.isArray(data.ids) ? data.ids.filter((item): item is string => typeof item === 'string') : [];

  return { ok, detail, ids };
}

function dropWait({ formData }) {
  const onlyStale = formData.get('stale') === '1';
  dropping = true;
  waitNote = '';

  return async ({ result }) => {
    dropping = false;
    const parsed = dropDetail(result.type === 'success' ? result.data : null);
    waitOk = parsed.ok;
    waitNote = parsed.detail;
    if (parsed.ok === false || parsed.ids.length === 0)
      return;

    const ids = new Set(parsed.ids);
    const gone = stats.rows.filter(row => ids.has(row.id) && row.status === 'needsHuman');
    const keptPassed = stats.passed.filter(row => ids.has(row.id) === false);
    const staleCut = onlyStale ? parsed.ids.length : gone.filter(row => rotten(row.at)).length;
    stats = {
      ...stats,
      waiting: Math.max(0, stats.waiting - parsed.ids.length),
      stale: Math.max(0, (stats.stale ?? 0) - staleCut),
      passedTotal: (stats.passedTotal ?? stats.passed.length) + parsed.ids.length,
      rows: stats.rows.filter(row => ids.has(row.id) === false),
      passed: [
        ...gone.map(row => ({
          id: row.id,
          company: row.company,
          title: row.title,
          url: row.url,
          reason: onlyStale ? 'протухло' : 'убрал из ждунов',
          at: Date.now(),
          when: 'сейчас',
        })),
        ...keptPassed,
      ],
    };
  };
}

function plainLabel(raw: string): string {
  return raw
    .replace(/<svg\b[\s\S]*$/i, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/<[^>\n]*/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function passedName(row: { company: string; title: string; id: string }): string {
  const company = plainLabel(row.company);
  const title = plainLabel(row.title);
  if (company.length > 0 && title.length > 0)
    return `${company} · ${title}`;

  if (title.length > 0)
    return title;

  return row.id;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const chipClass = 'inline-flex h-8 min-h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition hover:border-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 active:scale-[0.98]';

function rotten(at: number | undefined): boolean {
  return typeof at === 'number' && now - at >= WEEK_MS;
}

const statusText: Record<string, string> = {
  pending: 'в очереди',
  sent: 'откликнулся',
  needsHuman: 'ждёт тебя',
  dropped: 'снял',
};

const statusBadge: Record<string, string> = {
  pending: 'badge-primary',
  sent: 'badge-success',
  needsHuman: 'badge-warning',
  dropped: 'badge-ghost',
};

const checks = $derived([
  { ok: data.ready.telegram, label: 'Токен бота', miss: 'Токена нет. Вставь его в', href: '/admin/telegram', link: 'Telegram' },
  { ok: data.ready.model, label: 'Хотя бы одна модель', miss: 'Моделей нет. Добавь ключ в', href: '/admin/model', link: 'Модель' },
  { ok: data.ready.resume, label: 'Резюме привязано', miss: 'Резюме не привязано. Вставь ссылку в', href: '/admin/hh', link: 'HeadHunter' },
  { ok: data.ready.extension, label: 'Ссылка расширения выпущена', miss: 'Ссылки нет. Выпусти её в', href: '/admin/extension', link: 'Extension' },
  { ok: data.ready.live, label: 'Боевой режим', miss: 'Боевой режим выключен. Включи его кнопкой ниже.', href: '', link: '' },
]);
const allGreen = $derived(checks.every(row => row.ok));

function restartDetail(data: unknown): { ok: boolean; detail: string } {
  if (typeof data !== 'object' || data === null)
    return { ok: false, detail: 'не вышло' };

  const detail = 'detail' in data && typeof data.detail === 'string' ? data.detail : 'не вышло';
  const ok = 'ok' in data && data.ok === true;

  return { ok, detail };
}

const hoursLine = $derived(
  hoursOn
    ? 'ищем и откликаемся только с 9:00 до 22:00 по Москве'
    : 'ищем и откликаемся в любое время (для тестов)',
);

function hoursAnswer(payload: unknown): { ok: boolean; detail: string; hours: boolean | null } {
  if (typeof payload !== 'object' || payload === null)
    return { ok: false, detail: 'не вышло', hours: null };

  const ok = 'ok' in payload && payload.ok === true;
  const detail = 'detail' in payload && typeof payload.detail === 'string' && payload.detail.length > 0
    ? payload.detail
    : 'не вышло';
  const hours = 'hours' in payload && typeof payload.hours === 'boolean' ? payload.hours : null;

  return { ok, detail, hours };
}

function liveAnswer(result: { type: string; data?: unknown; error?: { message?: string } }): { ok: boolean; detail: string } {
  if (result.type === 'success' || result.type === 'failure')
    return restartDetail(result.data);

  const message = result.error?.message ?? '';

  return { ok: false, detail: message.length > 0 ? message : 'не вышло' };
}
</script>

<section class="mb-8 rounded-2xl border border-white/8 bg-[#151922] px-5 {allGreen ? 'py-3 lg:py-2' : 'py-4'}">
  <div class={allGreen ? 'lg:flex lg:items-center lg:gap-6' : ''}>
  <div class="flex items-center justify-between gap-3 {allGreen ? 'lg:contents' : ''}">
    <h2 class="text-base font-semibold {allGreen ? 'lg:shrink-0' : ''}">До старта</h2>
    <form
      class={allGreen ? 'lg:order-last lg:shrink-0' : ''}
      method="POST"
      action="?/live"
      use:enhance={() => {
        liveBusy = true;
        liveNote = '';
        return async ({ result, update }) => {
          const parsed = liveAnswer(result);
          let note = parsed.ok ? '' : parsed.detail;
          try {
            if (parsed.ok)
              await update();
          }
          catch (error) {
            const message = error instanceof Error ? error.message : '';
            note = message.length > 0 ? message : 'не вышло';
          }
          finally {
            liveBusy = false;
            liveNote = note;
          }
        };
      }}
    >
      <input name="hhLive" type="hidden" value={data.ready.live ? '' : '1'} />
      <button
        class="inline-flex shrink-0 cursor-pointer items-center rounded-lg border bg-[#10131a] px-2.5 py-1 text-xs font-medium whitespace-nowrap transition hover:border-white/30 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 {liveNote.length > 0 ? 'border-rose-400/50 text-rose-300' : 'border-white/15 text-zinc-100'}"
        type="submit"
        disabled={liveBusy}
        aria-live="polite"
        aria-busy={liveBusy}
      >
        {liveBusy ? 'Меняю…' : liveNote.length > 0 ? liveNote : data.ready.live ? 'Выключить боевой режим' : 'Включить боевой режим'}
      </button>
    </form>
  </div>
  {#if allGreen}
    <p class="mt-2 text-xs text-zinc-500 lg:mt-0 lg:shrink-0">С 9:00 до 22:00 МСК.</p>
  {/if}
  <ul class="mt-3 grid grid-cols-2 gap-x-4 {allGreen ? 'gap-y-1 lg:mt-0 lg:flex lg:min-w-0 lg:flex-1 lg:flex-wrap lg:items-center lg:gap-x-4 lg:gap-y-1' : 'gap-y-3'}">
    {#each checks as row (row.label)}
      <li>
        <div class="flex items-center gap-2">
          <span class="size-2 shrink-0 rounded-full {row.ok ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
          <span class={row.ok ? 'text-xs text-zinc-400' : 'text-sm text-zinc-200'}>{row.label}</span>
        </div>
        {#if row.ok === false}
          <p class="mt-1 pl-4 text-xs text-zinc-500">
            {row.miss}
            {#if row.href}
              <a class="text-zinc-300 underline-offset-4 hover:text-zinc-100 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400" href={row.href}>{row.link}</a>.
            {/if}
          </p>
        {/if}
      </li>
    {/each}
  </ul>
  </div>
</section>

<section class="mb-8">
  <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
    <h2 class="text-base font-semibold">Логирование</h2>
    <button
      class="inline-flex h-8 min-h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border bg-[#10131a] px-3 text-sm font-medium transition hover:border-white/30 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 active:scale-[0.98] {copyClass}"
      type="button"
      aria-live="polite"
      onclick={copyJournal}
    >
      {#if copyTone === 'ok'}
        <svg class="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="M5 12.5 9.5 17 19 7" />
        </svg>
      {:else}
        <svg class="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      {/if}
      {copyNote}
    </button>
  </div>
  <div class="overflow-hidden rounded-lg border border-white/10 bg-[#07080c] font-mono text-[13px] leading-snug">
    <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2">
      <div
        class="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-label="Время прогона"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(run.pct)}
        aria-valuetext={run.label}
      >
        <div class="h-full rounded-full bg-[#8eae9a]" style:width="{run.pct}%"></div>
      </div>
      {#if run.label}
        <span class="shrink-0 text-xs text-zinc-400 tabular-nums">{run.label}</span>
      {/if}
      {#if run.lap}
        <span class="shrink-0 text-xs text-zinc-200 tabular-nums">{run.lap}</span>
      {/if}
    </div>
    <p class="flex min-w-0 items-center gap-2 overflow-hidden border-b border-white/10 px-3 py-2 whitespace-nowrap">
      <span class="shrink-0 text-zinc-500">&gt;</span>
      <span class="min-w-0 truncate {liveStep.length > 0 ? 'text-[#9dccab]' : 'text-zinc-500'}">{liveStep.length > 0 ? liveStep : 'пульса ещё нет'}</span>
    </p>
    {#if logSnap.rows.length === 0}
      <p class="px-3 py-2 text-zinc-500">Пока тихо. Сюда попадают смена шага и поломки, не каждая секунда.</p>
    {:else}
      <ul use:keepLog class="max-h-80 overflow-x-hidden overflow-y-auto px-3 py-2 [overflow-anchor:none]" onscroll={onLogScroll}>
        {#each journalRows as row (logKey(row))}
          <li data-k={logKey(row)} class="flex items-baseline gap-x-2 py-0.5">
            <time class="shrink-0 text-xs text-zinc-500 tabular-nums whitespace-nowrap">{clock(row.at)}</time>
            <span class="shrink-0 text-xs text-zinc-500 whitespace-nowrap">{whoName[row.who] ?? row.who}</span>
            <span class="min-w-0 flex-1 break-words whitespace-normal {row.death ? 'text-[#c49090]' : 'text-zinc-200'}">{row.text}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<section class="mb-8">
  <div class="mb-3 flex flex-wrap gap-2" role="group" aria-label="Список вакансий">
    <button
      class="{chipClass} {board === 'accepted' ? 'border-white/50 bg-white/15 text-white' : 'border-white/15 bg-[#10131a] text-zinc-400 hover:text-zinc-100'}"
      type="button"
      aria-pressed={board === 'accepted'}
      onclick={() => showBoard('accepted')}
    >Принятые <span class="tabular-nums">{stats.accepted ?? 0}</span></button>
    <button
      class="{chipClass} {board === 'hidden' ? 'border-white/50 bg-white/15 text-white' : 'border-white/15 bg-[#10131a] text-zinc-400 hover:text-zinc-100'}"
      type="button"
      aria-pressed={board === 'hidden'}
      onclick={() => showBoard('hidden')}
    >Скрытые <span class="tabular-nums">{stats.passedTotal ?? stats.passed.length}</span></button>
    <button
      class="{chipClass} {board === 'waiting' ? 'border-white/50 bg-white/15 text-white' : 'border-white/15 bg-[#10131a] text-zinc-400 hover:text-zinc-100'}"
      type="button"
      aria-pressed={board === 'waiting'}
      onclick={() => showBoard('waiting')}
    >Ждуны <span class="tabular-nums">{stats.waiting}</span></button>
    {#if board === 'waiting' && stats.waiting > 0}
      <form method="POST" action="?/dropWaiting" use:enhance={dropWait}>
        <input type="hidden" name="all" value="1" />
        <button class="{chipClass} border-white/15 bg-[#10131a] text-zinc-300 hover:text-white" type="submit" disabled={dropping}>
          {dropping ? 'Убираю' : 'Очистить'}
        </button>
      </form>
      <form method="POST" action="?/dropWaiting" use:enhance={dropWait}>
        <input type="hidden" name="stale" value="1" />
        <button class="{chipClass} border-white/15 bg-[#10131a] text-zinc-300 hover:text-white" type="submit" disabled={dropping || (stats.stale ?? 0) === 0}>
          {dropping ? 'Убираю' : `Автоочистка ${stats.stale ?? 0}`}
        </button>
      </form>
    {/if}
    {#if waitNote}
      <p class="self-center text-xs {waitOk ? 'text-emerald-400' : 'text-rose-300'}">{waitNote}</p>
    {/if}
  </div>
  {#snippet vacancyLink(href: string, label: string, at: number | undefined)}
    <a class="underline-offset-4 hover:underline {rotten(at) ? 'text-zinc-500' : 'text-zinc-200'}" href={href} target="_blank" rel="noreferrer">{label}</a>
    {#if rotten(at)}
      <span class="ml-2 text-xs text-zinc-500">протухло</span>
    {/if}
  {/snippet}
  <div class="max-h-[26rem] overflow-x-hidden overflow-y-auto rounded-2xl border border-white/8 bg-[#151922]">
    {#if board === 'accepted'}
      {#if stats.rows.some(row => row.status !== 'needsHuman')}
        <table class="table">
          <thead class="sticky top-0 z-10">
            <tr class="bg-[#151922] text-xs text-zinc-500">
              <th>Вакансия</th>
              <th>Статус</th>
              <th>Когда</th>
            </tr>
          </thead>
          <tbody>
            {#each stats.rows.filter(row => row.status !== 'needsHuman') as row (row.id)}
              <tr>
                <td class="max-w-xs truncate">
                  {@render vacancyLink(row.url, `${plainLabel(row.company)} · ${plainLabel(row.title)}`, row.at)}
                </td>
                <td><span class="badge badge-sm {statusBadge[row.status] ?? 'badge-ghost'}">{statusText[row.status] ?? row.status}</span></td>
                <td class="whitespace-nowrap text-xs text-zinc-500">{row.when}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="px-5 py-8 text-sm text-zinc-500">Очередь пустая.</p>
      {/if}
    {:else if board === 'waiting'}
      {#if stats.rows.some(row => row.status === 'needsHuman')}
        <table class="table">
          <thead class="sticky top-0 z-10">
            <tr class="bg-[#151922] text-xs text-zinc-500">
              <th class="w-px"></th>
              <th>Вакансия</th>
              <th>Статус</th>
              <th>Причина</th>
              <th>Когда</th>
            </tr>
          </thead>
          <tbody>
            {#each stats.rows.filter(row => row.status === 'needsHuman') as row (row.id)}
              <tr>
                <td class="w-px pr-10">
                  <form method="POST" action="?/dropWaiting" use:enhance={dropWait}>
                    <input type="hidden" name="id" value={row.id} />
                    <button class="btn btn-ghost btn-xs h-7 min-h-7 w-7 px-0 text-lg leading-none text-zinc-500 hover:text-white" type="submit" aria-label="Удалить" disabled={dropping}>×</button>
                  </form>
                </td>
                <td class="max-w-xs truncate pl-2">
                  {@render vacancyLink(row.url, `${plainLabel(row.company)} · ${plainLabel(row.title)}`, row.at)}
                </td>
                <td><span class="badge badge-sm {statusBadge[row.status] ?? 'badge-ghost'}">{statusText[row.status] ?? row.status}</span></td>
                <td class="max-w-sm break-words whitespace-normal text-sm text-zinc-300">{row.reason || 'не записано'}</td>
                <td class="whitespace-nowrap text-xs text-zinc-500">{row.when}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="px-5 py-8 text-sm text-zinc-500">Ждунов нет.</p>
      {/if}
    {:else if stats.passed.length > 0}
      <table class="table">
        <thead class="sticky top-0 z-10">
          <tr class="bg-[#151922] text-xs text-zinc-500">
            <th>Вакансия</th>
            <th>Когда</th>
            <th>Причина</th>
          </tr>
        </thead>
        <tbody>
          {#each stats.passed as row (row.id)}
            <tr>
              <td class="max-w-xs break-words whitespace-normal">
                {@render vacancyLink(row.url, passedName(row), row.at)}
              </td>
              <td class="whitespace-nowrap text-xs text-zinc-500">{row.when}</td>
              <td class="max-w-xs break-words whitespace-normal text-sm text-zinc-300">{row.reason}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="px-5 py-8 text-sm text-zinc-500">Скрытых пока нет.</p>
    {/if}
  </div>
</section>

<header class="mb-8">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Обзор</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Сервисы</h1>
  <p class="mt-2 text-sm text-zinc-500">Карточка или пункт слева ведут в один и тот же раздел. Зелёная рамка значит, что ключ активирован.</p>
</header>

<div class="grid gap-4 md:grid-cols-3">
  {#each cards as card}
    <a
      class="rounded-2xl border bg-[#151922] p-6 transition hover:-translate-y-0.5 hover:bg-[#1a1f29] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 {card.light.ok ? 'border-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.2)]' : 'border-white/8'}"
      href={card.href}
    >
      <div class="flex items-center gap-3">
        <span class="size-3 rounded-full {card.light.ok ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]' : 'bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.7)]'}"></span>
        <p class="text-sm text-zinc-400">{card.light.name}</p>
      </div>
      <p class="mt-4 text-lg font-medium">{card.light.detail}</p>
    </a>
  {/each}
</div>

<section class="mt-8">
  <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
    <h2 class="text-lg font-semibold">Очередь</h2>
    <span class="badge badge-sm {stats.autopilot.auto ? 'badge-success' : 'badge-ghost'}">
      Автопилот {stats.autopilot.auto ? 'вкл' : 'выкл'}
    </span>
    <form
      class="contents"
      method="POST"
      action="?/restart"
      use:enhance={() => {
        restarting = true;
        restartNote = '';
        return async ({ result }) => {
          restarting = false;
          const parsed = restartDetail(result.type === 'success' ? result.data : null);
          restartOk = parsed.ok;
          restartNote = parsed.detail;
          if (parsed.ok) {
            const pilot = stats.autopilot;
            const runAt = pilot.auto === true && pilot.runAt > 0 ? pilot.runAt : Date.now();
            stats = { ...stats, autopilot: { ...pilot, auto: true, runAt } };
          }
        };
      }}
    >
      <button class="btn btn-ghost btn-sm h-8 min-h-8 px-3" type="submit" disabled={restarting}>
        {restarting ? 'Запускаю' : 'Перезапустить'}
      </button>
    </form>
    {#if restartNote}
      <p class="text-xs {restartOk ? 'text-emerald-400' : 'text-rose-300'}">{restartNote}</p>
    {/if}
    <p class="text-xs text-zinc-500">{polling ? 'Бот слушает команды.' : 'Бот молчит, пока нет токена телеги.'}</p>
    {#if stats.autopilot.lastNote}
      <p class="text-xs text-zinc-500">{stats.autopilot.lastNote}</p>
    {/if}
  </div>
  <form
    class="mb-4 max-w-xl rounded-2xl border border-white/8 bg-[#151922] px-5 py-4"
    method="POST"
    action="?/hours"
    use:enhance={() => {
      hoursSaving = true;
      hoursNote = '';
      return async ({ result, update }) => {
        const parsed = hoursAnswer(result.type === 'success' ? result.data : null);
        try {
          if (parsed.ok)
            await update({ reset: false });
        }
        finally {
          hoursSaving = false;
          hoursOk = parsed.ok;
          hoursNote = parsed.detail;
          if (parsed.ok && parsed.hours !== null)
            hoursOn = parsed.hours;
        }
      };
    }}
  >
    <h3 class="text-base font-semibold">Часы поиска</h3>
    <p class="mt-1 text-sm text-zinc-300">{hoursLine}</p>
    <input name="hhHours" type="hidden" value={hoursOn ? '0' : '1'} />
    <div class="mt-3 flex flex-wrap items-center gap-3">
      <button
        class="btn btn-ghost h-11 min-h-11 px-4 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 active:scale-[0.97] disabled:cursor-wait disabled:opacity-60"
        type="submit"
        disabled={hoursSaving}
        aria-pressed={hoursOn}
        aria-busy={hoursSaving}
      >{hoursSaving ? 'Сохраняю…' : hoursOn ? 'Включено' : 'Выключено'}</button>
      {#if hoursNote}
        <p class="text-sm {hoursOk ? 'text-emerald-300' : 'text-rose-300'}" aria-live="polite">{hoursNote}</p>
      {/if}
    </div>
  </form>
  <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
    {#each figures as figure (figure.label)}
      <div class="stat rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
        <div class="stat-title text-xs text-zinc-500">{figure.label}</div>
        <div class="stat-value text-3xl font-semibold text-white">{figure.value}</div>
      </div>
    {/each}
  </div>
</section>
