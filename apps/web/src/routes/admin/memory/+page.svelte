<script lang="ts">
import type { MemoryEntry } from '@cursor-chrome/hh';

import { onMount } from 'svelte';
import { fly } from 'svelte/transition';

let { data } = $props();

type Edit = { id: string; answer: string; prompt: string; aliases: string; picks: string[] };
type Pending = { entry: MemoryEntry; timer: ReturnType<typeof setTimeout> };

const UNDO_MS = 5_000;
const TYPES: Record<string, string> = { link: 'ссылка', number: 'число', yesno: 'да/нет', choice: 'выбор', multi: 'несколько', text: 'текст' };

let entries = $state.raw<MemoryEntry[]>(data.entries);
let query = $state('');
let kind = $state<'all' | 'memory' | 'rule'>('all');
let qtype = $state('all');
let editing = $state<Edit | null>(null);
let pending = $state<Pending | null>(null);
let flash = $state('');
let openLinks = $state<Record<string, boolean>>({});

const norm = (text: string) => text.toLowerCase().replace(/ё/g, 'е');

const shown = $derived(entries.filter((entry) => {
  if (pending?.entry.id === entry.id)
    return false;

  if (kind !== 'all' && entry.kind !== kind)
    return false;

  if (qtype !== 'all' && entry.qtype !== qtype)
    return false;

  const needle = norm(query.trim());

  return needle.length === 0 || [entry.prompt, entry.answer, ...entry.aliases].some(text => norm(text).includes(needle));
}));
const counts = $derived({ memory: entries.filter(entry => entry.kind === 'memory').length, rule: entries.filter(entry => entry.kind === 'rule').length });

function when(at: number): string {
  if (!at)
    return '—';

  return new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function call(op: string, id: string, extra: Record<string, unknown> = {}): Promise<string | null> {
  const res = await fetch('/admin/memory/entry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, id, ...extra }) }).catch(() => null);
  const body = res ? await res.json().catch(() => null) as { ok?: boolean; detail?: string; id?: string; entries?: MemoryEntry[] } | null : null;
  if (body?.ok !== true || body.entries === undefined) {
    flash = `не вышло: ${body?.detail ?? 'сервер не ответил'}`;

    return null;
  }

  flash = '';
  entries = body.entries;

  return body.id ?? id;
}

function edit(entry: MemoryEntry): void {
  editing = { id: entry.id, answer: entry.answer, prompt: entry.prompt, aliases: entry.aliases.join('\n'), picks: entry.answer.split(/\s*;\s*/).filter(Boolean) };
}

async function save(entry: MemoryEntry): Promise<void> {
  if (editing === null)
    return;

  const answer = entry.options.length > 0 ? editing.picks.join('; ') : editing.answer;
  const extra = entry.kind === 'rule' ? { answer, prompt: editing.prompt, aliases: editing.aliases.split('\n') } : { answer };
  if (await call('edit', entry.id, extra))
    editing = null;
}

function togglePick(option: string, multi: boolean, on: boolean): void {
  if (editing === null)
    return;

  editing.picks = multi ? (on ? [...editing.picks, option] : editing.picks.filter(item => item !== option)) : [option];
}

function remove(entry: MemoryEntry): void {
  if (pending)
    void commit(pending);

  const next: Pending = { entry, timer: setTimeout(() => void commit(next), UNDO_MS) };
  pending = next;
}

async function commit(item: Pending): Promise<void> {
  clearTimeout(item.timer);
  if (pending === item)
    pending = null;

  await call('delete', item.entry.id);
}

function undo(): void {
  if (pending) {
    clearTimeout(pending.timer);
    pending = null;
  }
}

onMount(() => () => {
  if (pending)
    void commit(pending);
});
</script>

<svelte:head><title>Память · ответы</title></svelte:head>

<header class="mb-5 flex flex-wrap items-end justify-between gap-4">
  <div>
    <h1 class="text-xl font-semibold text-white">Память</h1>
    <p class="mt-1 max-w-2xl text-xs text-zinc-500">Запомненные ответы и правила, которые подставляются в «Разборе». Правило перебивает память и черновик. Если ответ подцепился не к тому вопросу, отвяжи его ниже.</p>
  </div>
  <dl class="flex gap-4 text-sm tabular-nums">
    <div><dt class="text-[11px] text-zinc-500">в памяти</dt><dd class="text-white">{counts.memory}</dd></div>
    <div><dt class="text-[11px] text-zinc-500">правил</dt><dd class="text-indigo-300">{counts.rule}</dd></div>
  </dl>
</header>

<div class="mb-4 flex flex-wrap items-center gap-3 text-xs text-zinc-300">
  <input class="w-72 rounded-lg border border-white/10 bg-[#0b0d12] px-3 py-1.5 text-zinc-100 outline-none focus:border-indigo-400" type="search" placeholder="поиск по вопросу и ответу" bind:value={query} />
  <div class="flex rounded-lg border border-white/10 p-0.5" role="group" aria-label="Источник">
    {#each [['all', 'всё'], ['memory', 'память'], ['rule', 'правила']] as [value, label] (value)}
      <button class={['rounded-md px-2.5 py-1', kind === value ? 'bg-indigo-500/30 text-white' : 'text-zinc-400 hover:text-zinc-100']} type="button" aria-pressed={kind === value} onclick={() => kind = value as typeof kind}>{label}</button>
    {/each}
  </div>
  <label class="flex items-center gap-2">тип
    <select class="rounded-lg border border-white/10 bg-[#0b0d12] px-2 py-1.5 text-zinc-100" bind:value={qtype}>
      <option value="all">любой</option>
      {#each Object.entries(TYPES) as [value, label] (value)}<option {value}>{label}</option>{/each}
    </select>
  </label>
  <span class="ml-auto text-zinc-500">показано {shown.length} из {entries.length}</span>
</div>

{#if flash}<p class="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{flash}</p>{/if}

{#if shown.length === 0}
  <p class="rounded-2xl border border-white/8 bg-[#10131a] px-5 py-10 text-center text-sm text-zinc-500">Ничего не найдено.</p>
{:else}
  <ul class="flex flex-col gap-2">
    {#each shown as entry (entry.id)}
      <li class={['rounded-2xl border bg-[#10131a] px-4 py-3', entry.kind === 'rule' ? 'border-indigo-400/30' : 'border-white/8']}>
        <div class="flex items-start gap-3">
          <span class={['mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[11px]', entry.kind === 'rule' ? 'bg-indigo-500/25 text-indigo-100' : 'bg-white/8 text-zinc-300']}>{entry.kind === 'rule' ? 'правило' : 'память'}</span>
          <div class="min-w-0 flex-1">
            {#if editing?.id === entry.id}
              <form class="flex flex-col gap-2 text-xs" onsubmit={(event) => { event.preventDefault(); void save(entry); }}>
                {#if entry.kind === 'rule'}
                  <input class="rounded-lg border border-white/10 bg-[#0b0d12] px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-400" bind:value={editing.prompt} aria-label="Название правила" />
                {:else}
                  <p class="text-sm text-zinc-100">{entry.prompt}</p>
                {/if}
                {#if entry.options.length > 0}
                  <div class="flex flex-wrap gap-3 rounded-lg border border-white/10 bg-[#0b0d12] px-2 py-1.5">
                    {#each entry.options as option (option)}
                      <label class="flex items-center gap-1.5 text-zinc-200"><input class="accent-indigo-400" type={entry.qtype === 'multi' ? 'checkbox' : 'radio'} name="pick-{entry.id}" checked={editing.picks.includes(option)} onchange={event => togglePick(option, entry.qtype === 'multi', event.currentTarget.checked)} />{option}</label>
                    {/each}
                  </div>
                {:else}
                  <textarea class="min-h-16 rounded-lg border border-white/10 bg-[#0b0d12] px-2 py-1.5 text-zinc-100 outline-none focus:border-indigo-400" bind:value={editing.answer} aria-label="Ответ"></textarea>
                {/if}
                {#if entry.kind === 'rule'}
                  <label class="flex flex-col gap-1 text-zinc-400">Формулировки вопроса (по одной в строке)
                    <textarea class="min-h-16 rounded-lg border border-white/10 bg-[#0b0d12] px-2 py-1.5 text-zinc-100 outline-none focus:border-indigo-400" bind:value={editing.aliases}></textarea>
                  </label>
                {/if}
                <div class="flex gap-2">
                  <button class="rounded-lg bg-indigo-500/30 px-3 py-1.5 text-white hover:bg-indigo-500/40" type="submit">Сохранить</button>
                  <button class="rounded-lg px-3 py-1.5 text-zinc-300 hover:bg-white/10" type="button" onclick={() => editing = null}>Отмена</button>
                </div>
              </form>
            {:else}
              <p class="text-sm text-zinc-100">{entry.prompt}</p>
              <p class="mt-1 whitespace-pre-line break-words text-[13px] text-emerald-100/90">{entry.answer}</p>
              {#if entry.aliases.length > 1 || (entry.aliases.length === 1 && entry.aliases[0] !== entry.prompt)}
                <p class="mt-1 text-[11px] text-zinc-500">формулировки: {entry.aliases.join(' · ')}</p>
              {/if}
            {/if}
            <p class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
              <span>тип: {TYPES[entry.qtype] ?? entry.qtype}</span>
              {#if entry.kind === 'memory'}<span class={entry.human ? 'text-amber-300' : ''}>источник: {entry.human ? 'вручную (выше ИИ)' : 'ИИ / старое'}</span>{/if}
              <span>создано: {when(entry.created)}</span>
              <span>последнее использование: {when(entry.lastUsed)}</span>
              {#if entry.kind === 'memory'}<span>Ок с этим ответом: {entry.used}</span>{/if}
              <button class={['underline decoration-dotted', entry.matches > 0 ? 'text-sky-300 hover:text-sky-100' : 'text-zinc-500']} type="button" disabled={entry.matches === 0} onclick={() => openLinks[entry.id] = !openLinks[entry.id]}>совпадений с другими вопросами: {entry.matches}</button>
            </p>
            {#if openLinks[entry.id] && entry.linked.length > 0}
              <ul class="mt-2 flex flex-col gap-1 rounded-lg bg-white/[0.03] p-2">
                {#each entry.linked as link (link.key)}
                  <li class="flex items-center gap-2 text-xs text-zinc-300">
                    <span class="min-w-0 flex-1 truncate">↳ {link.prompt}</span>
                    <button class="shrink-0 rounded px-2 py-0.5 text-rose-300 hover:bg-rose-500/15" type="button" onclick={() => void call('unlink', entry.id, { linked: link.prompt })}>отвязать</button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
          <div class="flex shrink-0 flex-col items-end gap-1 text-xs">
            <button class="rounded px-2 py-1 text-zinc-300 hover:bg-white/10" type="button" onclick={() => edit(entry)}>изменить</button>
            {#if entry.kind === 'memory'}
              <button class="rounded px-2 py-1 text-indigo-300 hover:bg-indigo-500/15" type="button" onclick={() => void call('to-rule', entry.id)}>сделать правилом</button>
            {:else}
              <button class="rounded px-2 py-1 text-zinc-300 hover:bg-white/10" type="button" onclick={() => void call('to-memory', entry.id)}>в память</button>
            {/if}
            <button class="rounded px-2 py-1 text-rose-300 hover:bg-rose-500/15" type="button" onclick={() => remove(entry)}>удалить</button>
          </div>
        </div>
      </li>
    {/each}
  </ul>
{/if}

{#if pending}
  <div class="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-white/10 bg-[#1c212b] px-4 py-2 text-sm shadow-lg" transition:fly={{ y: 20, duration: 160 }}>
    <span class="max-w-md truncate text-zinc-200">Удалено: {pending.entry.prompt}</span>
    <button class="rounded-lg bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20" type="button" onclick={undo}>Отменить</button>
  </div>
{/if}
