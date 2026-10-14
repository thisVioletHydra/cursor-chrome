<script lang="ts">
import type { DraftRow, FormQuestion, ReviewAction, VacancyInfo } from '@cursor-chrome/hh';
import type { ReviewCard } from '$lib/review-types';

import FormView from './FormView.svelte';

type Props = {
  all: ReviewCard[];
  card: ReviewCard | undefined;
  info: VacancyInfo | null;
  drafts: DraftRow[];
  loading: boolean;
  note: string;
  rejecting: boolean;
  reasons: string[];
  doneOf: (id: string) => ReviewAction | 'hidden' | null;
  answerOf: (question: FormQuestion) => string;
  editedOf: (question: FormQuestion) => boolean;
  onAnswer: (question: FormQuestion, value: string) => void;
  onPick: (id: string) => void;
  onOk: () => void;
  onReject: (reason: string) => void;
  onAskReject: () => void;
  onLater: () => void;
  onDraft: () => void;
  onUnlink: (question: FormQuestion, target: string) => void;
  onRule: (question: FormQuestion) => void;
};

let { all, card, info, drafts, loading, note, rejecting, reasons, doneOf, answerOf, editedOf, onAnswer, onPick, onOk, onReject, onAskReject, onLater, onDraft, onUnlink, onRule }: Props = $props();

let listEl = $state<HTMLElement | null>(null);

const draftByPrompt = $derived(new Map(drafts.map(row => [row.prompt, row])));
const aiOf = (question: FormQuestion) => draftByPrompt.get(question.prompt)?.answer ?? '';
let descOpen = $state(false);
const editedCount = $derived(card ? card.questions.filter(question => editedOf(question)).length : 0);

// Keep the highlighted vacancy in view whenever the cursor moves.
$effect(() => {
  const id = card?.id;
  if (id === undefined || listEl === null)
    return;

  listEl.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

const mark: Record<string, string> = { approved: '✓', rejected: '✕', later: '⏲', hidden: '·' };
const markTone: Record<string, string> = { approved: 'text-emerald-300', rejected: 'text-rose-300', later: 'text-zinc-400', hidden: 'text-zinc-600' };
</script>

<div class="grid h-[calc(100vh-15rem)] min-h-[520px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)_17rem] gap-4">
  <section class="flex min-h-0 flex-col rounded-2xl border border-white/8 bg-[#10131a]" aria-label="Вакансия">
    {#if card}
      <header class="border-b border-white/8 px-5 py-4">
        <div class="flex items-start justify-between gap-3">
          <a class="text-base font-semibold text-zinc-100 hover:text-indigo-300" href={info?.url || card.url} target="_blank" rel="noreferrer">{info?.title || card.title}</a>
          <span class="shrink-0 text-[11px] text-zinc-500 tabular-nums">#{card.id}</span>
        </div>
        <p class="mt-1 text-sm text-zinc-300">{info?.company || card.company}</p>
        <p class="mt-1 flex flex-wrap gap-x-3 text-xs text-zinc-500">
          {#if info?.city || card.place}<span>{info?.city || card.place}</span>{/if}
          {#if info?.format}<span>{info.format}</span>{/if}
          <span class="text-zinc-300">{info?.salaryText || 'зарплата не указана'}</span>
          {#if info?.office}<span class="text-amber-300">офис/гибрид</span>{/if}
        </p>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div class="rounded-xl border border-white/8 bg-white/[0.02]">
          <button class="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-zinc-300 hover:text-white" type="button" aria-expanded={descOpen} onclick={() => descOpen = !descOpen}>
            <span>Описание вакансии</span><span class="text-zinc-500">{descOpen ? 'свернуть ▴' : 'развернуть ▾'}</span>
          </button>
          {#if descOpen}
            <div class="hh-desc border-t border-white/8 px-3 py-2 text-[13px] leading-relaxed text-zinc-300">{info?.description || (loading ? 'тяну описание с hh…' : 'Описание с hh ещё не подтянуто — нажми ↻.')}</div>
          {/if}
        </div>
        <h3 class="mt-5 mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Вариант ИИ <span class="font-normal normal-case text-zinc-500">· только чтение</span></h3>
        {#if card.partial}
          <p class="mb-2 rounded-lg bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">Форма не снята целиком: вопросы из коротких подсказок.</p>
        {/if}
        <FormView cardId={card.id} questions={card.questions} {drafts} readonly {loading} valueOf={aiOf} />
      </div>
    {:else}
      <p class="m-auto text-sm text-zinc-500">Нет вакансий.</p>
    {/if}
  </section>

  <section class="flex min-h-0 flex-col rounded-2xl border border-indigo-400/40 bg-[#10131a]" aria-label="Ответы">
    <header class="flex items-center justify-between border-b border-white/8 px-5 py-3">
      <h2 class="text-sm font-semibold text-zinc-100">Ответы с коррекцией <span class="text-xs font-normal text-zinc-500">· это и уйдёт по Ок{#if editedCount > 0} · <span class="text-amber-300">изменено: {editedCount}</span>{/if}</span></h2>
      <button class="rounded-lg px-2 py-1 text-xs text-zinc-400 hover:bg-white/10 hover:text-zinc-100 disabled:opacity-40" type="button" disabled={loading || card === undefined} title="Перегенерировать черновики" onclick={onDraft}>{loading ? 'думает…' : '↻ заново'}</button>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      {#if card}
        <FormView cardId={card.id} questions={card.questions} {drafts} readonly={false} {loading} valueOf={answerOf} {editedOf} {onAnswer} {onUnlink} {onRule} />
        {#if note}<p class="mt-3 text-[11px] text-rose-300">{note}</p>{/if}
      {/if}
    </div>
    <footer class="flex flex-col gap-2 border-t border-white/8 px-5 py-3">
      {#if rejecting}
        <div class="grid grid-cols-4 gap-1" role="group" aria-label="Причина отказа">
          {#each reasons as reason, index (reason)}
            <button class="rounded-lg border border-rose-400/40 bg-rose-500/10 px-1 py-1.5 text-xs text-rose-100 hover:bg-rose-500/25" type="button" onclick={() => onReject(reason)}><span class="text-rose-300/60">{index + 1}</span> {reason}</button>
          {/each}
        </div>
      {/if}
      <div class="flex items-center gap-2">
        <button class="flex-1 rounded-lg bg-emerald-500/20 px-2 py-2 text-sm text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40" type="button" disabled={card === undefined} onclick={onOk}>Ок <span class="text-emerald-300/60">↵</span></button>
        <button class="flex-1 rounded-lg bg-rose-500/15 px-2 py-2 text-sm text-rose-100 hover:bg-rose-500/25 disabled:opacity-40" type="button" disabled={card === undefined} onclick={onAskReject}>Reject <span class="text-rose-300/60">R</span></button>
        <button class="flex-1 rounded-lg bg-white/5 px-2 py-2 text-sm text-zinc-200 hover:bg-white/10 disabled:opacity-40" type="button" disabled={card === undefined} onclick={onLater}>Позже <span class="text-zinc-500">L</span></button>
      </div>
    </footer>
  </section>

  <nav class="flex min-h-0 flex-col rounded-2xl border border-white/8 bg-[#10131a]" aria-label="Очередь">
    <h2 class="border-b border-white/8 px-4 py-3 text-sm font-semibold text-zinc-100">Очередь <span class="text-xs font-normal text-zinc-500">· {all.length}</span></h2>
    <ol class="min-h-0 flex-1 overflow-y-auto p-2" bind:this={listEl}>
      {#each all as item, index (item.id)}
        {@const done = doneOf(item.id)}
        <li data-id={item.id}>
          <button
            class={[
              'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition',
              item.id === card?.id ? 'bg-indigo-500/20 ring-1 ring-indigo-400/70' : 'hover:bg-white/5',
              done ? 'opacity-45' : '',
            ]}
            type="button"
            aria-current={item.id === card?.id ? 'true' : undefined}
            disabled={done !== null}
            onclick={() => onPick(item.id)}
          >
            <span class="w-5 shrink-0 pt-0.5 text-right text-[11px] text-zinc-500 tabular-nums">{index + 1}</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-xs text-zinc-100">{item.info?.title || item.title}</span>
              <span class="block truncate text-[11px] text-zinc-500">{item.info?.company || item.company}</span>
            </span>
            {#if done}<span class={['shrink-0 text-xs', markTone[done]]}>{mark[done]}</span>{/if}
          </button>
        </li>
      {/each}
    </ol>
  </nav>
</div>

<style>
  .hh-desc { white-space: pre-line; }
</style>
