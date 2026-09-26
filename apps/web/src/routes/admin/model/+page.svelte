<script lang="ts">
import { enhance } from '$app/forms';
import Out from '$lib/Out.svelte';

let { data } = $props();

let providerId = $state('groq');
let key = $state('');
let model = $state('');
let url = $state('');
let phase = $state<'idle' | 'checking'>('idle');
let message = $state('');
let ok = $state(false);
let openUnlink = $state(false);
let phrase = $state('');

const preset = $derived(data.presets.find(item => item.id === providerId) ?? data.presets[0]);
const custom = $derived(providerId === 'custom');
const ready = $derived(key.trim().length > 0 && (custom === false || (url.trim().startsWith('https://') && model.trim().length > 0)));

function pick(id: string) {
  providerId = id;
  const next = data.presets.find(item => item.id === id);
  model = next?.model ?? '';
  url = '';
  message = '';
}

$effect(() => {
  if (model.length === 0 && preset)
    model = preset.model;
});
</script>

<header class="mb-5">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Модель</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Цепочка провайдеров</h1>
  <p class="mt-2 text-sm text-zinc-500">Отвечает первый живой. Упал или упёрся в лимит — идём к следующему, упавший отдыхает минуту. Все ходят в OpenAI-совместимый chat/completions.</p>
</header>

{#if data.providers.length > 0}
  <section class="rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-base font-semibold text-white">Подключено</h2>
      <button class="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-rose-400 transition hover:bg-rose-500 hover:text-white focus-visible:bg-rose-500 focus-visible:text-white focus-visible:outline-none" type="button" onclick={() => { phrase = ''; openUnlink = true; }}>Убрать все</button>
    </div>
    <ol class="mt-3 divide-y divide-white/6">
      {#each data.providers as row, index (row.host + row.model + row.keyTail)}
        <li class="flex items-center gap-3 py-3 text-sm">
          <span class="grid size-7 shrink-0 place-items-center rounded-full bg-white/8 text-xs text-zinc-300">{index + 1}</span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-zinc-100">{row.name} <span class="text-zinc-500">· {row.model}</span></p>
            <p class="truncate text-xs text-zinc-500">{row.host} · ключ …{row.keyTail}</p>
          </div>
          {#if index > 0}
            <form method="POST" action="?/raise" use:enhance>
              <input name="index" type="hidden" value={index} />
              <button class="btn btn-ghost btn-sm" type="submit" aria-label="Поднять выше">↑</button>
            </form>
          {/if}
          <form method="POST" action="?/remove" use:enhance>
            <input name="index" type="hidden" value={index} />
            <button class="btn btn-ghost btn-sm text-rose-400" type="submit" aria-label="Убрать">✕</button>
          </form>
        </li>
      {/each}
    </ol>
  </section>
{/if}

<section class="mt-4 rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
  <h2 class="text-base font-semibold text-white">Добавить провайдера</h2>
  <div class="mt-3 flex flex-wrap gap-2">
    {#each data.presets as item (item.id)}
      <button
        class="cursor-pointer rounded-full border px-3 py-1.5 text-sm transition {providerId === item.id ? 'border-indigo-400 bg-indigo-500/20 text-white' : 'border-white/10 text-zinc-400 hover:border-white/30 hover:text-zinc-200'}"
        type="button"
        onclick={() => pick(item.id)}
      >
        {item.name}{#if item.free}<span class="ml-1.5 text-[10px] tracking-wide text-emerald-300 uppercase">free</span>{/if}
      </button>
    {/each}
  </div>

  {#if preset && preset.keysUrl}
    <p class="mt-3 text-sm text-zinc-400">Ключ: <Out href={preset.keysUrl} text={preset.keysUrl.replace(/^https:\/\//, '')} />. Модель можно поменять, если у провайдера её переименовали.</p>
  {:else if custom}
    <p class="mt-3 text-sm text-zinc-400">Любой сервер с OpenAI-совместимым <span class="font-mono text-xs">POST …/chat/completions</span>.</p>
  {/if}

  {#if message}
    <p class="mt-3 font-mono text-xs {ok ? 'text-emerald-300' : 'text-rose-300'}">{message}</p>
  {/if}

  <form
    class="mt-4 grid gap-3"
    method="POST"
    action="?/add"
    use:enhance={() => {
      phase = 'checking';
      message = 'проверяю';
      ok = false;
      return async ({ result, update }) => {
        phase = 'idle';
        const body = result.type === 'success' ? result.data : null;
        ok = body?.ok === true;
        message = typeof body?.detail === 'string' ? body.detail : 'не вышло';
        if (ok) {
          key = '';
          await update({ reset: false });
        }
      };
    }}
  >
    <input name="provider" type="hidden" value={providerId} />
    {#if custom}
      <input
        class="input input-bordered h-11 w-full border-white/10 bg-black/30 text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-400 focus:outline-none"
        name="url"
        type="url"
        autocomplete="off"
        placeholder="https://host/v1/chat/completions"
        bind:value={url}
      />
    {/if}
    <div class="flex items-end gap-3">
      <input
        class="input input-bordered h-11 min-w-0 flex-1 border-white/10 bg-black/30 text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-400 focus:outline-none"
        name="key"
        type="password"
        autocomplete="off"
        placeholder="API key"
        readonly={phase === 'checking'}
        bind:value={key}
      />
      <input
        class="input input-bordered h-11 w-56 border-white/10 bg-black/30 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-400 focus:outline-none"
        name="model"
        autocomplete="off"
        placeholder="модель"
        bind:value={model}
      />
      <button class="btn btn-primary h-11 min-h-11 shrink-0 px-4" type="submit" disabled={ready === false || phase === 'checking'}>
        {phase === 'checking' ? 'Проверяю' : 'Проверить и добавить'}
      </button>
    </div>
  </form>
</section>

{#if openUnlink}
  <dialog class="modal modal-open">
    <div class="modal-box border border-white/10 bg-[#151922]">
      <form method="POST" action="?/unlink">
        <p class="text-sm leading-6 text-zinc-300">Впиши unlink, чтобы убрать всех провайдеров.</p>
        <input class="input input-bordered mt-4 w-full border-white/10 bg-black/30 focus:border-indigo-400 focus:outline-none" name="phrase" autocomplete="off" bind:value={phrase} />
        <input name="section" type="hidden" value="model" />
        <div class="mt-5 flex gap-3">
          <button class="btn btn-error" type="submit" disabled={phrase !== 'unlink'}>Убрать</button>
          <button class="btn btn-ghost" type="button" onclick={() => openUnlink = false}>Закрыть</button>
        </div>
      </form>
    </div>
    <button class="modal-backdrop" type="button" aria-label="Закрыть" onclick={() => openUnlink = false}></button>
  </dialog>
{/if}
