<script lang="ts">
import { enhance } from '$app/forms';
import { onMount, tick } from 'svelte';

let { data } = $props();
let stats = $state(data.stats);
let polling = $state(data.polling);
let shownPulse = $state('');
let watchLog = $state<{ at: number; who: string; text: string; death: boolean }[]>([]);
let watchList = $state<HTMLUListElement>();
let followLog = true;
let restarting = $state(false);
let restartNote = $state('');
let restartOk = $state(false);
let hoursOn = $state(data.hours !== false);
let hoursSaving = $state(false);
let hoursNote = $state('');
let hoursOk = $state(false);

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
  const timer = setInterval(() => {
    void refresh();
  }, 4_000);
  void refresh();

  return () => clearInterval(timer);
});

async function refresh(): Promise<void> {
  const res = await fetch('/admin/live').catch(() => null);
  if (res === null || res.ok === false)
    return;

  const body = await res.json() as {
    polling?: boolean;
    figures?: { today: number; queued: number; waiting: number; invitations: number; discards: number; waitingReply: number };
    rows?: typeof stats.rows;
    autopilot?: { auto: boolean; lastNote: string };
    judged?: number;
    pulse?: { line?: string };
    log?: { at: number; who: string; text: string; death: boolean }[];
  };
  if (body.figures)
    stats = { ...stats, ...body.figures, rows: body.rows ?? stats.rows, judged: body.judged ?? stats.judged, autopilot: body.autopilot ?? stats.autopilot };

  polling = body.polling === true;
  notePulse(typeof body.pulse?.line === 'string' ? body.pulse.line : '');
  watchLog = Array.isArray(body.log) ? body.log : [];
}

const STEP_MAX = 80;
const STEP_PREFIX = /^(открыл|ищу|читаю|в очереди|мимо,|сервер|админка|жду|уже видели)/;
const HARD_SKIP = /^(удалёнку запрещают|удаленку запрещают|джуниор|1C или Bitrix ядром|Python основной бэк)$/i;
const SKIP_ESSAY = /вакансия требует|стек не сов|скип,|удал[её]нку запрещают|не наш стек/i;

function notePulse(line: string): void {
  if (headerStep(line))
    shownPulse = line.trim();
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
  if (headerStep(shownPulse))
    return shownPulse;

  for (let index = watchLog.length - 1; index >= 0; index -= 1) {
    const row = watchLog[index];
    if (row !== undefined && row.death === false && headerStep(row.text))
      return row.text;
  }

  return '';
});

function clock(at: number): string {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(at);
}

function onLogScroll(): void {
  if (watchList === undefined)
    return;

  followLog = watchList.scrollHeight - watchList.scrollTop - watchList.clientHeight < 40;
}

$effect(() => {
  const rows = watchLog;
  if (followLog === false || rows.length === 0)
    return;

  void tick().then(() => {
    if (watchList === undefined)
      return;

    watchList.scrollTop = watchList.scrollHeight;
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
  { label: 'Ждём', value: stats.waitingReply },
]);

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
  { ok: data.ready.queries, label: 'Запросы поиска сохранены', miss: 'Запросы не сохранены. Запиши их в', href: '/admin/hh', link: 'HeadHunter' },
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
</script>

<section class="mb-8 rounded-2xl border border-white/8 bg-[#151922] px-5 {allGreen ? 'py-3' : 'py-4'}">
  <h2 class="text-base font-semibold">До старта</h2>
  {#if allGreen}
    <p class="mt-2 text-xs text-zinc-500">С 9:00 до 22:00 МСК.</p>
  {/if}
  <ul class="mt-3 grid grid-cols-2 gap-x-4 {allGreen ? 'gap-y-1' : 'gap-y-3'}">
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
  <form
    class="mt-3"
    method="POST"
    action="?/live"
    use:enhance={() => {
      return async ({ result, update }) => {
        if (result.type === 'success')
          await update();
      };
    }}
  >
    <input name="hhLive" type="hidden" value={data.ready.live ? '' : '1'} />
    <button class="btn btn-ghost h-11 min-h-11 px-4" type="submit">
      {data.ready.live ? 'Выключить боевой режим' : 'Включить боевой режим'}
    </button>
  </form>
</section>

<section class="mb-8">
  <h2 class="mb-3 text-base font-semibold">Логирование</h2>
  <div class="overflow-hidden rounded-lg border border-white/10 bg-[#07080c] font-mono text-[13px] leading-snug">
    <p class="flex min-w-0 items-center gap-2 overflow-hidden border-b border-white/10 px-3 py-2 whitespace-nowrap">
      <span class="shrink-0 text-zinc-500">&gt;</span>
      <span class="min-w-0 truncate {liveStep.length > 0 ? 'text-[#9dccab]' : 'text-zinc-500'}">{liveStep.length > 0 ? liveStep : 'пульса ещё нет'}</span>
    </p>
    {#if watchLog.length === 0}
      <p class="px-3 py-2 text-zinc-500">Пока тихо. Сюда попадают смена шага и поломки, не каждая секунда.</p>
    {:else}
      <ul bind:this={watchList} class="max-h-80 overflow-x-hidden overflow-y-auto px-3 py-2" onscroll={onLogScroll}>
        {#each watchLog as row (row.at + row.who + row.text)}
          <li class="flex items-baseline gap-x-2 py-0.5">
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
  <div class="max-h-[26rem] overflow-x-auto overflow-y-auto rounded-2xl border border-white/8 bg-[#151922]">
    {#if stats.rows.length > 0}
      <table class="table">
        <thead class="sticky top-0 z-10">
          <tr class="bg-[#151922] text-xs text-zinc-500">
            <th>Вакансия</th>
            <th>Статус</th>
            <th>Когда</th>
          </tr>
        </thead>
        <tbody>
          {#each stats.rows as row (row.id)}
            <tr>
              <td class="max-w-xs truncate">
                <a class="text-zinc-200 underline-offset-4 hover:underline" href={row.url} target="_blank" rel="noreferrer">{row.company} · {row.title}</a>
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
          if (parsed.ok)
            stats = { ...stats, autopilot: { ...stats.autopilot, auto: true } };
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
    {#each figures as figure}
      <div class="stat rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
        <div class="stat-title text-xs text-zinc-500">{figure.label}</div>
        <div class="stat-value text-3xl font-semibold text-white">{figure.value}</div>
      </div>
    {/each}
  </div>
</section>
