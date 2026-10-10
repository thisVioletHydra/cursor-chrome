<script lang="ts">
import { invalidateAll } from '$app/navigation';
import { enhance } from '$lib/admin-forms';

type Flag = {
  level: 'red' | 'orange' | 'yellow';
  risk: string;
  think: string;
};

type Scan = {
  score: number;
  flags: Flag[];
  via: string;
  at: number;
  stale: boolean;
  outdated: boolean;
};

const DOT = {
  red: 'bg-rose-400',
  orange: 'bg-orange-400',
  yellow: 'bg-amber-300',
} as const;

const LEVEL = {
  red: 'красный',
  orange: 'оранжевый',
  yellow: 'жёлтый',
} as const;

let { data } = $props();
let scanning = $state(false);
let pulling = $state(false);
let error = $state('');
let pullError = $state('');
let fresh = $state<Scan | null>(null);
const scan = $derived(fresh ?? data.scan);
const hasText = $derived(data.chars > 0);
const SCAN_WAIT_MS = 62_000;
const PULL_WAIT_MS = 40_000;
const askName = $derived(data.askName);
const whenOf = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function flagsOf(value: unknown): Flag[] {
  if (Array.isArray(value) === false)
    return [];

  const flags: Flag[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Object.hasOwn(item, 'level') === false)
      continue;

    const level = Reflect.get(item, 'level');
    const risk = Reflect.get(item, 'risk');
    const think = Reflect.get(item, 'think');
    if ((level !== 'red' && level !== 'orange' && level !== 'yellow') || typeof risk !== 'string' || typeof think !== 'string')
      continue;

    flags.push({ level, risk, think });
  }

  return flags;
}

function takeResume() {
  pulling = true;
  pullError = '';
  let settled = false;
  const timer = window.setTimeout(() => {
    if (settled)
      return;

    settled = true;
    window.removeEventListener('message', onMessage);
    pulling = false;
    pullError = 'расширение не ответило. Обнови его и эту страницу.';
  }, PULL_WAIT_MS);

  function onMessage(event: MessageEvent) {
    if (event.origin !== location.origin || event.source !== window)
      return;

    const body = event.data;
    if (typeof body !== 'object' || body === null || body.type !== 'cc-pull-resume-result')
      return;
    if (settled)
      return;

    settled = true;
    window.clearTimeout(timer);
    window.removeEventListener('message', onMessage);
    pulling = false;
    if (body.ok !== true) {
      pullError = typeof body.reason === 'string' && body.reason.length > 0 ? body.reason : 'не вышло';
      return;
    }

    void invalidateAll();
  }

  window.addEventListener('message', onMessage);
  window.postMessage({ type: 'cc-pull-resume' }, location.origin);
}
</script>

<header class="mb-5">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">HeadHunter</p>
  <h1 class="mt-1 bg-[linear-gradient(to_bottom,#fff_0%,#fff_30%,#c6c6cc_56%,#2a2a2e_82%,#1c1c1c_100%)] bg-clip-text text-7xl leading-none font-semibold tracking-tight text-transparent">ATS</h1>
</header>

<div class="grid min-w-0 w-full grid-cols-1 items-start gap-4">
  <section class="min-w-0 rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
    <h2 class="text-base font-semibold text-white">Резюме</h2>
    {#if hasText}
      <div class="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <p class="inline-flex items-center gap-1.5 text-sm text-white">
          <svg class="size-5 shrink-0 text-zinc-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
            <path d="M14 3v6h6" />
          </svg>
          <svg class="size-4 shrink-0 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
            <path d="M5 13l4 4L19 7" />
          </svg>
          Резюме сохранено
        </p>
        <a
          class="link link-hover min-w-0 truncate text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          href="https://hh.ru/resume/{data.resumeId}"
          target="_blank"
          rel="noreferrer"
        >https://hh.ru/resume/{data.resumeId}</a>
      </div>
      <p class="mt-1 text-xs text-zinc-500">{whenOf.format(data.fetchedAt)} · {data.chars.toLocaleString('ru-RU')} знаков</p>
    {:else if data.linked}
      <p class="mt-2 text-sm text-zinc-400">Ссылка сохранена. Текста резюме тут ещё нет.</p>
      {#if pullError}
        <p class="mt-3 font-mono text-xs text-rose-300">{pullError}</p>
      {/if}
      <button
        class="btn btn-primary mt-4 h-11 min-h-11 px-4 transition active:scale-[0.97] disabled:cursor-wait disabled:opacity-60"
        type="button"
        disabled={pulling}
        aria-busy={pulling}
        onclick={takeResume}
      >
        {pulling ? 'Забираю…' : 'Забрать резюме'}
      </button>
    {:else}
      <p class="mt-2 text-sm text-zinc-400">Ссылки на резюме нет. Привяжи её в HeadHunter.</p>
    {/if}
  </section>

  <section class="min-w-0 rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
    <h2 class="text-base font-semibold text-white">Разбор</h2>
    {#if scan}
      <p class="mt-3 text-4xl font-semibold tracking-tight {scan.outdated ? 'text-zinc-500' : ''}">{scan.score} из 100</p>
      {#if scan.outdated}
        <p class="mt-2 text-sm text-amber-200">Старый скан, без разбора. Просканируй ещё раз.</p>
      {:else}
        <p class="mt-1 text-xs text-zinc-500">Просмотр рекрутером или ATS в первые секунды, не оценка человека.</p>
        <ul class="mt-4 divide-y divide-white/6">
          {#each scan.flags as flag}
            <li class="flex min-w-0 gap-3 py-2.5">
              <span class="mt-1.5 size-2 shrink-0 rounded-full {DOT[flag.level]}" title={LEVEL[flag.level]}></span>
              <div class="min-w-0">
                <p class="text-sm break-words text-zinc-100">{flag.risk}</p>
                <p class="mt-0.5 text-sm break-words text-zinc-400">{flag.think}</p>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
      <p class="mt-4 text-xs text-emerald-300">ответила {scan.via} · {whenOf.format(scan.at)}</p>
      {#if scan.stale}
        <p class="mt-2 text-xs text-amber-200">Резюме с тех пор другое.</p>
      {/if}
    {:else}
      <p class="mt-3 text-4xl font-semibold tracking-tight text-zinc-500">— из 100</p>
      <p class="mt-2 text-sm text-zinc-400">Скана ещё нет.</p>
    {/if}
    {#if error}
      <p class="mt-3 font-mono text-xs text-rose-300">{error}</p>
    {/if}
    {#if hasText === false}
      <p class="mt-3 text-sm text-zinc-400">{data.linked ? 'Сначала забери текст резюме.' : 'Сначала привяжи резюме.'}</p>
    {/if}
    <form
      class="mt-4"
      method="POST"
      action="?/scan"
      use:enhance={({ controller }) => {
        scanning = true;
        error = '';
        let settled = false;
        const timer = window.setTimeout(() => {
          if (settled)
            return;

          settled = true;
          scanning = false;
          error = 'модель не ответила, попробуй ещё раз';
          controller.abort();
        }, SCAN_WAIT_MS);
        return async ({ result, update }) => {
          if (settled)
            return;

          settled = true;
          window.clearTimeout(timer);
          scanning = false;
          if (result.type !== 'success') {
            error = 'сеть отвалилась, попробуй ещё раз';
            return;
          }

          const body = result.data;
          if (body?.ok !== true) {
            error = typeof body?.detail === 'string' ? body.detail : 'не вышло';
            return;
          }

          const score = typeof body.score === 'number' ? body.score : Number.NaN;
          const flags = flagsOf(body.flags);
          if (Number.isInteger(score) === false || flags.length < 6) {
            error = 'ответ без разбора';
            return;
          }

          fresh = {
            score,
            flags,
            via: typeof body.via === 'string' ? body.via : askName,
            at: typeof body.at === 'number' ? body.at : Date.now(),
            stale: false,
            outdated: false,
          };
          await update();
          fresh = null;
        };
      }}
    >
      <button
        class="btn btn-primary h-11 min-h-11 px-4 transition active:scale-[0.97] disabled:opacity-60 {scanning ? 'disabled:cursor-wait' : 'disabled:cursor-not-allowed'}"
        type="submit"
        disabled={scanning || hasText === false}
        aria-busy={scanning}
        title={hasText ? '' : 'Сначала забери текст резюме'}
      >
        {scanning ? `Спрашиваю ${askName}…` : 'Просканировать'}
      </button>
    </form>
  </section>
</div>
