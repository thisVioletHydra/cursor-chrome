<script lang="ts">
import { enhance } from '$app/forms';

type Field = { name: string; label: string; secret: boolean };
type Memory = { draft: Record<string, string>; message: string };

function readMemory(section: string): Memory {
  if (typeof sessionStorage === 'undefined')
    return { draft: {}, message: '' };

  try {
    const raw = sessionStorage.getItem(`key-draft:${section}`);
    if (raw === null)
      return { draft: {}, message: '' };

    const parsed = JSON.parse(raw) as Partial<Memory>;

    return {
      draft: parsed.draft ?? {},
      message: parsed.message ?? '',
    };
  }
  catch {
    return { draft: {}, message: '' };
  }
}

function writeMemory(section: string, next: Memory) {
  sessionStorage.setItem(`key-draft:${section}`, JSON.stringify(next));
}

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

const hints: Record<string, string> = {
  telegramToken: '7123456789:AAHxx...',
  mistralKey: 'abcdef0123456789...',
  hhAccessToken: 'USER...',
  hhResumeId: 'a1b2c3d4ff0e123456',
};

function hint(name: string): string {
  return hints[name] ?? '';
}

const ready = $derived(fields.every(field => (draft[field.name] ?? '').trim().length > 0));
const output = $derived(active ? detail : message);
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

function rememberField(name: string, value: string) {
  const kept = readMemory(section);
  writeMemory(section, { draft: { ...kept.draft, [name]: value }, message });
}

$effect(() => {
  if (typeof sessionStorage === 'undefined')
    return;

  if (active) {
    sessionStorage.removeItem(`key-draft:${section}`);
    return;
  }

  const kept = readMemory(section);
  draft = { ...kept.draft };
  message = kept.message;
  if (kept.message.length > 0)
    phase = 'error';
});

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
      writeMemory(section, { draft: $state.snapshot(draft), message });
      const nextWait = typeof data?.wait === 'number' ? data.wait : 0;
      if (nextWait > 0)
        armWait(nextWait);
    };
  }}
>
  <input name="section" type="hidden" value={section} />
  {#if output}
    <div class="mb-6 overflow-hidden rounded-xl border border-white/10 bg-black font-mono text-xs">
      <div class="flex gap-1.5 border-b border-white/10 px-3 py-2">
        <span class="size-2 rounded-full bg-rose-400"></span>
        <span class="size-2 rounded-full bg-amber-300"></span>
        <span class="size-2 rounded-full bg-emerald-400"></span>
      </div>
      <pre class="px-3 py-3 leading-5 whitespace-pre-wrap text-zinc-300"><span class="text-emerald-400">$</span> {section}{'\n'}{output}{#if waitLeft > 0}{'\n'}retry {waitLeft}s{/if}</pre>
    </div>
  {/if}
  <div class="grid gap-6">
    {#each fields as field, index}
      <div class="flex items-end gap-3">
        <label class="flex min-w-0 flex-1 flex-col gap-2 text-sm text-zinc-400">
          {field.label}
          <span class="relative block">
            <input
              class="input input-bordered h-11 w-full border-white/10 bg-black/30 text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-400 focus:outline-none disabled:text-transparent"
              name={field.name}
              type={field.secret ? 'password' : 'text'}
              autocomplete="off"
              placeholder={active ? '' : hint(field.name)}
              readonly={phase === 'checking'}
              disabled={active}
              bind:value={draft[field.name]}
              oninput={(event) => {
                const input = event.currentTarget;
                if ((input instanceof HTMLInputElement) === false)
                  return;

                rememberField(field.name, input.value);
              }}
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
