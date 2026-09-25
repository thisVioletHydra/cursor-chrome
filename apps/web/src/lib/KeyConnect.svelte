<script lang="ts">
import { enhance } from '$app/forms';

type Field = { name: string; label: string; secret: boolean };

let {
  section,
  active,
  detail,
  fields,
}: {
  section: 'telegram' | 'mistral' | 'hh';
  active: boolean;
  detail: string;
  fields: Field[];
} = $props();

let draft: Record<string, string> = $state({});
let phase = $state<'idle' | 'checking' | 'error'>('idle');
let message = $state('');
let waitLeft = $state(0);
let openUnlink = $state(false);
let phrase = $state('');
let tick: ReturnType<typeof setInterval> | undefined;

const ready = $derived(fields.every(field => (draft[field.name] ?? '').trim().length > 0));
const showCheck = $derived(active === false && (ready || phase === 'checking' || waitLeft > 0));

function armWait(seconds: number) {
  waitLeft = seconds;
  clearInterval(tick);
  tick = setInterval(() => {
    waitLeft -= 1;
    if (waitLeft > 0)
      return;

    waitLeft = 0;
    clearInterval(tick);
  }, 1000);
}
</script>

<form
  class="rounded-2xl border border-white/8 bg-[#151922] p-5"
  method="POST"
  action="?/verify"
  use:enhance={() => {
    phase = 'checking';
    message = 'проверяю';
    return async ({ result }) => {
      const data = result.type === 'success' ? result.data : null;
      if (data?.ok === true) {
        phase = 'idle';
        message = '';
        window.location.reload();
        return;
      }

      phase = 'error';
      message = typeof data?.detail === 'string' ? data.detail : 'не вышло';
      const wait = typeof data?.wait === 'number' ? data.wait : 30;
      if (wait > 0)
        armWait(wait);
    };
  }}
>
  <input name="section" type="hidden" value={section} />
  <p class="mb-5 text-sm text-zinc-400">{active ? detail : message}</p>
  <div class="grid gap-5">
    {#each fields as field, index}
      <div class="flex items-end gap-3">
        <label class="flex min-w-0 flex-1 flex-col gap-2 text-sm text-zinc-400">
          {field.label}
          <span class="relative block">
            <input
              class="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-zinc-100 outline-none focus:border-indigo-400 disabled:text-transparent"
              name={field.name}
              type={field.secret ? 'password' : 'text'}
              autocomplete="off"
              disabled={active}
              readonly={phase === 'checking'}
              bind:value={draft[field.name]}
            />
            {#if active}
              <span class="absolute inset-0 rounded-xl bg-black/55"></span>
            {/if}
          </span>
        </label>
        {#if index === fields.length - 1 && showCheck}
          <button
            class="h-11 shrink-0 rounded-xl bg-indigo-500 px-4 text-sm text-white disabled:opacity-50"
            type="submit"
            disabled={phase === 'checking' || waitLeft > 0 || ready === false}
          >
            {phase === 'checking' ? 'Проверяю' : waitLeft > 0 ? `Проверить · ${waitLeft}` : 'Проверить'}
          </button>
        {/if}
      </div>
    {/each}
  </div>
</form>

{#if active}
  <button
    class="mt-4 w-full max-w-md rounded-xl bg-rose-600 px-4 py-3 text-sm font-medium text-white"
    type="button"
    onclick={() => {
      phrase = '';
      openUnlink = true;
    }}
  >Отвязать</button>
{/if}

{#if openUnlink}
  <div class="fixed inset-0 z-30 grid place-items-center bg-black/60 px-4">
    <form class="w-full max-w-sm rounded-2xl border border-white/10 bg-[#151922] p-5" method="POST" action="?/unlink">
      <p class="text-sm text-zinc-300">Впиши unlink, чтобы отвязать.</p>
      <input class="mt-4 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-zinc-100 outline-none" name="phrase" autocomplete="off" bind:value={phrase} />
      <input name="section" type="hidden" value={section} />
      <div class="mt-4 flex gap-3">
        <button class="rounded-xl bg-rose-600 px-4 py-2 text-sm text-white disabled:opacity-40" type="submit" disabled={phrase !== 'unlink'}>Отвязать</button>
        <button class="rounded-xl border border-white/15 px-4 py-2 text-sm text-zinc-300" type="button" onclick={() => openUnlink = false}>Закрыть</button>
      </div>
    </form>
  </div>
{/if}
