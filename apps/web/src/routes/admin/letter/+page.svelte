<script lang="ts">
import { enhance } from '$app/forms';

let { data } = $props();
let draft = $state('');
let message = $state('');
let ok = $state(false);

$effect(() => {
  draft = data.coverLetter;
});
</script>

<header class="mb-5">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">HeadHunter</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Сопроводительное</h1>
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
