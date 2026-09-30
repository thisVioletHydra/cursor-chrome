<script lang="ts">
import { enhance } from '$app/forms';

let { data } = $props();
let draft = $state('');
let message = $state('');
let ok = $state(false);
const COPY_LABEL = 'Скопировать';
let copyNote = $state(COPY_LABEL);
let copyTone = $state<'idle' | 'ok' | 'fail'>('idle');
let copyTimer: ReturnType<typeof setTimeout> | undefined;

const copyClass = $derived(
  copyTone === 'ok'
    ? 'border-emerald-400/50 text-emerald-300'
    : copyTone === 'fail'
      ? 'border-rose-400/50 text-rose-300'
      : 'border-white/15 text-zinc-100',
);

$effect(() => {
  draft = data.coverLetter;
});

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

async function copyLetter(): Promise<void> {
  const text = draft.replace(/\r\n/g, '\n');
  if (text.trim().length === 0) {
    flashCopy('письмо пустое', 'fail');

    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    flashCopy('Скопировано', 'ok');
  }
  catch (error) {
    const detail = error instanceof Error ? error.message : '';
    flashCopy(detail.length > 0 ? detail : 'не скопировалось', 'fail');
  }
}
</script>

<header class="mb-5 flex flex-wrap items-end justify-between gap-3">
  <div>
    <p class="text-xs tracking-wide text-zinc-500 uppercase">HeadHunter</p>
    <h1 class="mt-1 text-3xl font-semibold tracking-tight">Сопроводительное</h1>
  </div>
  <button
    class="inline-flex h-8 min-h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border bg-[#10131a] px-3 text-sm font-medium transition hover:border-white/30 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 active:scale-[0.98] {copyClass}"
    type="button"
    aria-live="polite"
    onclick={copyLetter}
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
</header>

<section class="rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
  <p class="text-sm text-zinc-400">Этот текст расширение вставляет в каждый отклик. Подтягивается при следующем «Разобрать очередь».</p>
  {#if message}
    <p class="mt-3 font-mono text-xs {ok ? 'text-emerald-300' : 'text-rose-300'}">{message}</p>
  {/if}
  <form
    class="mt-4 grid gap-3"
    method="POST"
    action="?/save"
    use:enhance={() => {
      message = '';
      return async ({ result, update }) => {
        const body = result.type === 'success' ? result.data : null;
        ok = body?.ok === true;
        message = typeof body?.detail === 'string' ? body.detail : 'не вышло';
        if (ok)
          await update({ reset: false });
      };
    }}
  >
    <textarea
      class="textarea textarea-bordered min-h-72 w-full border-white/10 bg-black/30 text-sm leading-6 text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-400 focus:outline-none"
      name="coverLetter"
      autocomplete="off"
      placeholder="Здравствуйте..."
      bind:value={draft}
    ></textarea>
    <div class="flex items-center gap-3">
      <button class="btn btn-primary h-11 min-h-11 px-4" type="submit" disabled={draft.trim().length === 0 || draft.trim() === data.coverLetter}>Сохранить</button>
      <span class="text-xs text-zinc-500">{draft.length} / 4000</span>
    </div>
  </form>
</section>
