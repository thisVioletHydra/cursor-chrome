<script lang="ts">
import type { CanonAnswer } from '@cursor-chrome/hh';

let { items = $bindable(), highlight = 0 }: { items: CanonAnswer[]; highlight?: number } = $props();

type Draft = { id: number; title: string; answer: string; aliases: string };

let open = $state(false);

export function reveal(): void {
  open = true;
}
let editing = $state<Draft | null>(null);
let note = $state('');

const list = $derived(items);

function edit(item?: CanonAnswer): void {
  editing = item ? { id: item.id, title: item.title, answer: item.answer, aliases: item.aliases.join('\n') } : { id: 0, title: '', answer: '', aliases: '' };
  note = '';
}

async function save(): Promise<void> {
  if (editing === null)
    return;

  const res = await fetch('/admin/review/canon', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...editing, aliases: editing.aliases.split('\n') }) });
  const body = await res.json().catch(() => null) as { ok?: boolean; detail?: string; item?: CanonAnswer } | null;
  if (body?.ok !== true || body.item === undefined) {
    note = body?.detail ?? 'не сохранилось';

    return;
  }

  const saved = body.item;
  items = [...list.filter(item => item.id !== saved.id), saved].sort((left, right) => left.title.localeCompare(right.title, 'ru'));
  editing = null;
}

async function remove(item: CanonAnswer): Promise<void> {
  const res = await fetch('/admin/review/canon', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: item.id }) });
  if (res.ok)
    items = list.filter(row => row.id !== item.id);
}
</script>

<section class="mb-5 rounded-2xl border border-white/8 bg-[#10131a]">
  <button class="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-zinc-200" type="button" aria-expanded={open} onclick={() => open = !open}>
    <span>Канонические ответы и правила <span class="text-xs text-zinc-500">· {list.length} · перебивают память и черновик</span></span>
    <span class="text-zinc-500">{open ? '▴' : '▾'}</span>
  </button>
  {#if open}
    <div class="flex flex-col gap-3 border-t border-white/8 px-4 py-3">
      {#each list as item (item.id)}
        <article class={['flex items-start gap-3 rounded-xl px-3 py-2 text-xs', item.id === highlight ? 'bg-indigo-500/15 ring-1 ring-indigo-400/50' : 'bg-white/[0.03]']}>
          <div class="min-w-0 flex-1">
            <p class="font-medium text-zinc-100">{item.title}</p>
            <p class="mt-0.5 whitespace-pre-line break-all text-zinc-300">{item.answer}</p>
            <p class="mt-1 text-zinc-500">вопросы: {item.aliases.join(' · ') || '—'}</p>
          </div>
          <button class="rounded px-2 py-1 text-zinc-300 hover:bg-white/10" type="button" onclick={() => edit(item)}>изменить</button>
          <button class="rounded px-2 py-1 text-rose-300 hover:bg-rose-500/15" type="button" onclick={() => remove(item)}>удалить</button>
        </article>
      {/each}
      {#if editing}
        <form class="grid gap-2 text-xs md:grid-cols-3" onsubmit={(event) => { event.preventDefault(); void save(); }}>
          <label class="flex flex-col gap-1 text-zinc-400">Название
            <input class="rounded-lg border border-white/10 bg-[#0b0d12] px-2 py-1.5 text-zinc-100 outline-none focus:border-indigo-400" bind:value={editing.title} />
          </label>
          <label class="flex flex-col gap-1 text-zinc-400">Ответ
            <textarea class="min-h-20 rounded-lg border border-white/10 bg-[#0b0d12] px-2 py-1.5 text-zinc-100 outline-none focus:border-indigo-400" bind:value={editing.answer}></textarea>
          </label>
          <label class="flex flex-col gap-1 text-zinc-400">Похожие вопросы (по одному в строке)
            <textarea class="min-h-20 rounded-lg border border-white/10 bg-[#0b0d12] px-2 py-1.5 text-zinc-100 outline-none focus:border-indigo-400" bind:value={editing.aliases}></textarea>
          </label>
          <div class="flex items-center gap-2 md:col-span-3">
            <button class="rounded-lg bg-indigo-500/30 px-3 py-1.5 text-white hover:bg-indigo-500/40" type="submit">Сохранить</button>
            <button class="rounded-lg px-3 py-1.5 text-zinc-300 hover:bg-white/10" type="button" onclick={() => editing = null}>Отмена</button>
            {#if note}<span class="text-rose-300">{note}</span>{/if}
          </div>
        </form>
      {:else}
        <button class="self-start rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/10" type="button" onclick={() => edit()}>+ канонический ответ</button>
      {/if}
    </div>
  {/if}
</section>
