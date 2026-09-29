<script lang="ts">
import { enhance } from '$app/forms';

type Scan = {
  score: number;
  flags: string[];
  via: string;
  at: number;
  stale: boolean;
};

let { data } = $props();
let scanning = $state(false);
let error = $state('');
let fresh = $state<Scan | null>(null);
const scan = $derived(fresh ?? data.scan);
const SCAN_WAIT_MS = 35_000;
const askName = $derived(data.providers[0]?.name ?? 'модель');
const whenOf = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function flagsOf(value: unknown): string[] {
  if (Array.isArray(value) === false)
    return [];

  return value.filter((item): item is string => typeof item === 'string');
}
</script>

<header class="mb-5">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">HeadHunter</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">ATS</h1>
</header>

<div class="grid items-start gap-4 lg:grid-cols-2">
  <section class="rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
    <h2 class="text-base font-semibold text-white">Факты и сопроводительное</h2>
    <p class="mt-2 text-sm text-zinc-400">Полного резюме с hh.ru тут нет. Оцениваем этот текст.</p>
    <pre class="mt-4 max-h-[calc(100dvh-16rem)] overflow-y-auto font-sans text-sm leading-6 whitespace-pre-wrap text-zinc-200">{data.source}</pre>
  </section>

  <section class="rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
    <h2 class="text-base font-semibold text-white">Для робота</h2>
    {#if scan}
      <p class="mt-3 text-4xl font-semibold tracking-tight">{scan.score} из 100</p>
      <p class="mt-1 text-xs text-zinc-500">100 — робот пропустит. 0 — мусор.</p>
      {#if scan.flags.length === 0}
        <p class="mt-4 text-sm text-zinc-300">красных флагов нет</p>
      {:else}
        <ul class="mt-4 grid gap-2">
          {#each scan.flags as flag}
            <li class="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{flag}</li>
          {/each}
        </ul>
      {/if}
      <p class="mt-4 text-xs text-emerald-300">ответила {scan.via} · {whenOf.format(scan.at)}</p>
      {#if scan.stale}
        <p class="mt-2 text-xs text-amber-200">Сопроводительное с тех пор другое.</p>
      {/if}
    {:else}
      <p class="mt-3 text-4xl font-semibold tracking-tight text-zinc-500">— из 100</p>
      <p class="mt-2 text-sm text-zinc-400">Скана ещё нет.</p>
    {/if}
    {#if error}
      <p class="mt-3 font-mono text-xs text-rose-300">{error}</p>
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
          if (Number.isInteger(score) === false) {
            error = 'ответ без оценки';
            return;
          }

          fresh = {
            score,
            flags: flagsOf(body.flags),
            via: typeof body.via === 'string' ? body.via : askName,
            at: typeof body.at === 'number' ? body.at : Date.now(),
            stale: false,
          };
          await update();
          fresh = null;
        };
      }}
    >
      <button class="btn btn-primary h-11 min-h-11 px-4" type="submit" disabled={scanning} aria-busy={scanning}>
        {scanning ? `Спрашиваю ${askName}…` : 'Просканировать'}
      </button>
    </form>
  </section>
</div>
