<script lang="ts">
import { enhance } from '$app/forms';

type Field = { name: string; label: string; secret: boolean };

let {
  section,
  active,
  detail,
  wait,
  fields,
}: {
  section: 'telegram' | 'mistral' | 'hh';
  active: boolean;
  detail: string;
  wait: number;
  fields: Field[];
} = $props();

let draft: Record<string, string> = $state({});
let phase = $state<'idle' | 'checking' | 'error'>('idle');
let message = $state('');
let waitLeft = $state(0);
let openUnlink = $state(false);
let phrase = $state('');
let tick: ReturnType<typeof setInterval> | undefined;
let armed = false;

const ready = $derived(fields.every(field => (draft[field.name] ?? '').trim().length > 0));
const locked = $derived(active || phase === 'checking' || waitLeft > 0);
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

$effect(() => {
  if (armed || wait < 1 || active)
    return;

  armed = true;
  armWait(wait);
});
</script>

<form
  class="rounded-2xl border border-white/8 bg-[#151922] p-7"
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
      const nextWait = typeof data?.wait === 'number' ? data.wait : 30;
      if (nextWait > 0)
        armWait(nextWait);
    };
  }}
>
  <input name="section" type="hidden" value={section} />
  <p class="mb-6 text-sm text-zinc-400">{active ? detail : message}</p>
  <div class="grid gap-6">
    {#each fields as field, index}
      <div class="flex items-end gap-3">
        <label class="flex min-w-0 flex-1 flex-col gap-2 text-sm text-zinc-400">
          {field.label}
          <span class="relative block">
            <input
              class="input input-bordered h-11 w-full border-white/10 bg-black/30 text-zinc-100 focus:border-indigo-400 focus:outline-none disabled:text-transparent"
              name={field.name}
              type={field.secret ? 'password' : 'text'}
              autocomplete="off"
              readonly={locked && active === false}
              disabled={active}
              bind:value={draft[field.name]}
            />
            {#if active}
              <span class="absolute inset-0 rounded-lg bg-black/55"></span>
            {/if}
          </span>
        </label>
        {#if index === fields.length - 1 && showCheck}
          <button
            class="btn btn-primary h-11 min-h-11 shrink-0 px-4"
            type="submit"
            disabled={locked || ready === false}
          >
            {phase === 'checking' ? 'Проверяю' : waitLeft > 0 ? `Проверить · ${waitLeft}` : 'Проверить'}
          </button>
        {/if}
      </div>
    {/each}
  </div>
</form>

{#if active}
  <button class="btn btn-error mt-6 h-12 min-h-12 w-72 max-w-full" type="button" onclick={() => { phrase = ''; openUnlink = true; }}>
    Отвязать
  </button>
{/if}

{#if openUnlink}
  <dialog class="modal modal-open">
    <div class="modal-box border border-white/10 bg-[#151922]">
      <form method="POST" action="?/unlink">
        <p class="text-sm leading-6 text-zinc-300">Впиши unlink, чтобы отвязать.</p>
        <input class="input input-bordered mt-4 w-full border-white/10 bg-black/30 focus:border-indigo-400 focus:outline-none" name="phrase" autocomplete="off" bind:value={phrase} />
        <input name="section" type="hidden" value={section} />
        <div class="mt-5 flex gap-3">
          <button class="btn btn-error" type="submit" disabled={phrase !== 'unlink'}>Отвязать</button>
          <button class="btn btn-ghost" type="button" onclick={() => openUnlink = false}>Закрыть</button>
        </div>
      </form>
    </div>
    <button class="modal-backdrop" type="button" aria-label="Закрыть" onclick={() => openUnlink = false}></button>
  </dialog>
{/if}
