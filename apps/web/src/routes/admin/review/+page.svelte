<script lang="ts">
import type { CanonAnswer, DecisionAnswer, FormQuestion, ReviewAction } from '@cursor-chrome/hh';
import type { DraftReply, ReviewCard as Card } from '$lib/review-types';

import { onMount } from 'svelte';

import { sameAnswer } from '$lib/review-choice';
import { fly } from 'svelte/transition';

import CanonPanel from './CanonPanel.svelte';
import ReviewColumns from './ReviewColumns.svelte';

let { data } = $props();

type Pending = { card: Card; action: ReviewAction; reason: string; answers: DecisionAnswer[]; timer: ReturnType<typeof setTimeout> };
type Fetched = { reply: DraftReply | null; loading: boolean };

const UNDO_MS = 5_000;
const AUTO_DRAFTS = 4;

let gone = $state<Record<string, true>>({});
let edits = $state<Record<string, Record<string, string>>>({});
let fetched = $state<Record<string, Fetched>>({});
let pending = $state<Pending | null>(null);
let undoLeft = $state(0);
let undoTick: ReturnType<typeof setInterval> | undefined;
let cursor = $state(0);
let rejecting = $state<string | null>(null);
let hideOffice = $state(false);
let minSalary = $state<number | null>(null);
let delta = $state({ sent: 0, rejected: 0, later: 0 });
let flash = $state('');
let okNote = $state('');
let canon = $state.raw<CanonAnswer[]>(data.canon);
let ruleId = $state(0);
let decided = $state<Record<string, ReviewAction>>({});

const infoOf = (card: Card) => fetched[card.id]?.reply?.info ?? card.info;

function salaryOf(card: Card): number | null {
  const info = infoOf(card);
  if (info === null || info.currency !== 'RUR')
    return null;

  return info.salaryTo ?? info.salaryFrom;
}

function passes(card: Card): boolean {
  if (hideOffice && infoOf(card)?.office === true)
    return false;

  const top = salaryOf(card);

  return minSalary === null || minSalary <= 0 || top === null || top >= minSalary;
}

const open = $derived(data.cards.filter(card => gone[card.id] !== true));
const shown = $derived(open.filter(passes));
const focusedId = $derived(shown[Math.min(cursor, shown.length - 1)]?.id ?? '');
const current = $derived(shown.find(item => item.id === focusedId));
const counts = $derived({
  left: open.length,
  sent: data.counts.sent + delta.sent,
  rejected: data.counts.rejected + delta.rejected,
  later: data.counts.later + delta.later,
});

function draftsOf(card: Card) {
  return fetched[card.id]?.reply?.drafts ?? card.drafts;
}

function answerOf(card: Card, question: FormQuestion): string {
  const edited = edits[card.id]?.[question.prompt];
  if (edited !== undefined)
    return edited;

  return draftsOf(card).find(row => row.prompt === question.prompt)?.answer ?? '';
}

function draftOf(card: Card, question: FormQuestion) {
  return draftsOf(card).find(row => row.prompt === question.prompt);
}

function editedOf(card: Card, question: FormQuestion): boolean {
  const edited = edits[card.id]?.[question.prompt];

  return edited !== undefined && sameAnswer(question, edited, draftOf(card, question)?.answer ?? '') === false;
}

async function rule(card: Card, question: FormQuestion): Promise<void> {
  const answer = answerOf(card, question).trim();
  const source = draftOf(card, question)?.source?.target ?? '';
  const res = await fetch('/admin/review/rule', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: question.prompt, answer, source }) }).catch(() => null);
  const body = res ? await res.json().catch(() => null) as { ok?: boolean; detail?: string; item?: CanonAnswer } | null : null;
  if (body?.ok !== true || body.item === undefined) {
    flash = `правило не сохранилось: ${body?.detail ?? 'сервер не ответил'}`;

    return;
  }

  const saved = body.item;
  canon = [...canon.filter(item => item.id !== saved.id), saved].sort((left, right) => left.title.localeCompare(right.title, 'ru'));
  ruleId = saved.id;
  const source2 = { kind: 'canon' as const, target: `c:${saved.id}`, from: saved.title, score: 1, method: 'правило' };
  const drafts = draftsOf(card).map(row => (row.prompt === question.prompt ? { ...row, answer, missing: false, why: '', model: 'canon', source: source2 } : row));
  fetched[card.id] = { reply: { info: infoOf(card), drafts, error: fetched[card.id]?.reply?.error ?? '' }, loading: false };
  if (edits[card.id])
    delete edits[card.id][question.prompt];
  okNote = `Правило «${saved.title}» → «${answer.slice(0, 60)}» сохранено в каноне`;
  setTimeout(() => okNote = '', 4_000);
}

function setAnswer(card: Card, question: FormQuestion, value: string): void {
  edits[card.id] = { ...edits[card.id], [question.prompt]: value };
}

async function loadDraft(card: Card): Promise<void> {
  if (fetched[card.id]?.loading)
    return;

  fetched[card.id] = { reply: fetched[card.id]?.reply ?? null, loading: true };
  try {
    const res = await fetch('/admin/review/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: card.id }) });
    const reply = await res.json() as DraftReply;
    fetched[card.id] = { reply: { info: reply.info ?? null, drafts: reply.drafts ?? [], error: reply.error ?? (res.ok ? '' : `ошибка ${res.status}`) }, loading: false };
  }
  catch {
    fetched[card.id] = { reply: { info: card.info, drafts: card.drafts, error: 'сервер не ответил' }, loading: false };
  }
}

// Fetch drafts only for the next few cards; the server serialises model calls anyway.
async function pump(): Promise<void> {
  for (const card of shown.slice(0, AUTO_DRAFTS)) {
    if (card.drafts.length === 0 && fetched[card.id] === undefined)
      await loadDraft(card);
  }
}

onMount(() => {
  void pump();

  return () => {
    if (pending)
      void commit(pending);
  };
});

async function unlink(card: Card, question: FormQuestion, target: string): Promise<void> {
  const res = await fetch('/admin/review/unlink', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: card.id, prompt: question.prompt, target }) }).catch(() => null);
  if (res?.ok !== true) {
    flash = 'не отвязалось';

    return;
  }

  const drafts = draftsOf(card).map(row => (row.prompt === question.prompt ? { ...row, answer: '', missing: true, why: 'отвязано — впиши ответ или перегенерируй ↻', model: '', source: undefined } : row));
  fetched[card.id] = { reply: { info: infoOf(card), drafts, error: fetched[card.id]?.reply?.error ?? '' }, loading: false };
  if (edits[card.id])
    delete edits[card.id][question.prompt];
}

function answersOf(card: Card): DecisionAnswer[] {
  return card.questions.map((question) => {
    const source = draftOf(card, question)?.source?.target;

    return { key: question.prompt, prompt: question.prompt, answer: answerOf(card, question), ...(source ? { source } : {}), edited: editedOf(card, question), kind: question.kind, options: question.options };
  });
}

function act(card: Card, action: ReviewAction, reason = ''): void {
  if (pending)
    void commit(pending);

  rejecting = null;
  gone[card.id] = true;
  decided[card.id] = action;
  delta = { ...delta, ...bump(action, 1) };
  const next: Pending = { card, action, reason, answers: action === 'approved' ? answersOf(card) : [], timer: setTimeout(() => void commit(next), UNDO_MS) };
  pending = next;
  undoLeft = UNDO_MS / 1000;
  clearInterval(undoTick);
  undoTick = setInterval(() => {
    undoLeft = Math.max(0, undoLeft - 1);
  }, 1000);
  void pump();
  queueMicrotask(() => scrollToCursor());
}

function bump(action: ReviewAction, by: number): Partial<typeof delta> {
  if (action === 'approved')
    return { sent: delta.sent + by };

  if (action === 'rejected')
    return { rejected: delta.rejected + by };

  return { later: delta.later + by };
}

async function commit(item: Pending): Promise<void> {
  clearTimeout(item.timer);
  if (pending === item) {
    pending = null;
    clearInterval(undoTick);
  }

  const res = await fetch('/admin/review/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: item.card.id, action: item.action, reason: item.reason, answers: item.answers }),
  }).catch(() => null);
  const body = res ? await res.json().catch(() => null) as { ok?: boolean; detail?: string } | null : null;
  if (body?.ok !== true) {
    restore(item);
    flash = `не сохранилось: ${body?.detail ?? 'сервер не ответил'}`;
  }
}

function restore(item: Pending): void {
  delete gone[item.card.id];
  delete decided[item.card.id];
  delta = { ...delta, ...bump(item.action, -1) };
}

function undo(): void {
  if (pending === null)
    return;

  const item = pending;
  clearTimeout(item.timer);
  clearInterval(undoTick);
  pending = null;
  restore(item);
  cursor = Math.max(0, shown.findIndex(card => card.id === item.card.id));
}

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
}

function move(by: number): void {
  if (shown.length === 0)
    return;

  cursor = Math.min(shown.length - 1, Math.max(0, cursor + by));
  scrollToCursor();
}

function scrollToCursor(): void {
  void maybeDraft();
}

function pick(id: string): void {
  const index = shown.findIndex(card => card.id === id);
  if (index >= 0) {
    cursor = index;
    void maybeDraft();
  }
}

async function maybeDraft(): Promise<void> {
  const card = shown.find(item => item.id === focusedId);
  if (card && card.drafts.length === 0 && fetched[card.id] === undefined)
    await loadDraft(card);
}

function doneOf(id: string): ReviewAction | 'hidden' | null {
  if (decided[id])
    return decided[id];

  return gone[id] === undefined && shown.some(card => card.id === id) === false ? 'hidden' : null;
}

function enterOnControl(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && event.target instanceof HTMLElement && event.target.closest('button, a') !== null;
}

function withModifier(event: KeyboardEvent): boolean {
  return event.altKey || event.metaKey || event.ctrlKey;
}

function submitFromField(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey) && typing(event.target);
}

function onKey(event: KeyboardEvent): void {
  if (enterOnControl(event))
    return;

  if (event.key === 'Escape') {
    rejecting = null;
    if (event.target instanceof HTMLElement)
      event.target.blur();

    return;
  }

  if (submitFromField(event)) {
    event.preventDefault();
    hotkey('Enter');

    return;
  }

  if (typing(event.target) || withModifier(event))
    return;

  if (hotkey(event.key))
    event.preventDefault();
}

function hotkey(key: string): boolean {
  const card = shown.find(item => item.id === focusedId);
  const moves: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  if (key in moves) {
    move(moves[key] ?? 0);

    return true;
  }

  if (key.toLowerCase() === 'z' && pending) {
    undo();

    return true;
  }

  if (card === undefined)
    return false;

  return cardKey(card, key);
}

function cardKey(card: Card, key: string): boolean {
  const pick = rejecting === card.id ? Number.parseInt(key, 10) : Number.NaN;
  if (Number.isInteger(pick) && pick >= 1 && pick <= data.reasons.length) {
    act(card, 'rejected', data.reasons[pick - 1] ?? '');

    return true;
  }

  const lower = key.toLowerCase();
  if (key === 'Enter')
    act(card, 'approved');
  else if (lower === 'r' || lower === 'к')
    rejecting = rejecting === card.id ? null : card.id;
  else if (lower === 'l' || lower === 'д')
    act(card, 'later');
  else
    return false;

  return true;
}
</script>

<svelte:window onkeydown={onKey} />

<svelte:head><title>Разбор · ждуны</title></svelte:head>

<header class="mb-5 flex flex-wrap items-end justify-between gap-4">
  <div>
    <h1 class="text-xl font-semibold text-white">Разбор</h1>
    <p class="mt-1 max-w-2xl text-xs text-zinc-500">
      Ждуны с вопросами работодателя. «Ок» сохраняет твои ответы и запоминает их для таких же вопросов. Отправка отклика с ответами на hh — пункт 8, пока не подключена.
    </p>
  </div>
  <dl class="flex gap-4 text-sm tabular-nums">
    <div><dt class="text-[11px] text-zinc-500">осталось</dt><dd class="text-white">{counts.left}</dd></div>
    <div><dt class="text-[11px] text-zinc-500">отправлено*</dt><dd class="text-emerald-300">{counts.sent}</dd></div>
    <div><dt class="text-[11px] text-zinc-500">отклонено</dt><dd class="text-rose-300">{counts.rejected}</dd></div>
    <div><dt class="text-[11px] text-zinc-500">позже</dt><dd class="text-zinc-300">{counts.later}</dd></div>
  </dl>
</header>

<div class="mb-4 flex flex-wrap items-center gap-4 text-xs text-zinc-300">
  <label class="flex items-center gap-2"><input type="checkbox" class="accent-indigo-400" bind:checked={hideOffice} /> скрыть офис/гибрид</label>
  <label class="flex items-center gap-2">мин. зарплата, ₽
    <input class="w-28 rounded-lg border border-white/10 bg-[#0b0d12] px-2 py-1 text-zinc-100 outline-none focus:border-indigo-400" type="number" min="0" step="10000" placeholder="любая" bind:value={minSalary} />
  </label>
  {#if shown.length !== open.length}<span class="text-zinc-500">скрыто фильтрами: {open.length - shown.length}</span>{/if}
  <span class="ml-auto text-[11px] text-zinc-500">↑↓ ←→ вакансии · Enter ок · R отказ, затем 1–4 · L позже · Z отмена · ⌘↵ ок из поля</span>
</div>

<CanonPanel bind:items={canon} highlight={ruleId} />

{#if okNote}
  <p class="mb-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{okNote}</p>
{/if}
{#if flash}
  <p class="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{flash}</p>
{/if}

{#if shown.length === 0}
  <p class="mb-3 rounded-2xl border border-white/8 bg-[#10131a] px-5 py-4 text-center text-sm text-zinc-500">{open.length === 0 ? 'Все ждуны разобраны.' : 'Всё скрыто фильтрами.'}</p>
{/if}
  <ReviewColumns
    all={data.cards}
    card={current}
    info={current ? infoOf(current) : null}
    drafts={current ? draftsOf(current) : []}
    loading={current ? fetched[current.id]?.loading === true : false}
    note={current ? fetched[current.id]?.reply?.error ?? '' : ''}
    rejecting={current !== undefined && rejecting === current.id}
    reasons={data.reasons}
    {doneOf}
    answerOf={question => (current ? answerOf(current, question) : '')}
    editedOf={question => (current ? editedOf(current, question) : false)}
    onAnswer={(question, value) => current && setAnswer(current, question, value)}
    onPick={pick}
    onOk={() => current && act(current, 'approved')}
    onReject={reason => current && act(current, 'rejected', reason)}
    onAskReject={() => current && (rejecting = rejecting === current.id ? null : current.id)}
    onLater={() => current && act(current, 'later')}
    onDraft={() => current && void loadDraft(current)}
    onUnlink={(question, target) => current && void unlink(current, question, target)}
    onRule={question => current && void rule(current, question)}
  />

<p class="mt-4 text-[11px] text-zinc-600">* «отправлено» = одобрено с ответами; реальная отправка на hh появится в п.8.</p>

{#if pending}
  <div class="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-white/10 bg-[#1c212b] px-4 py-2 text-sm shadow-lg" transition:fly={{ y: 20, duration: 160 }}>
    <span class="text-zinc-200">{pending.action === 'approved' ? 'Ок' : pending.action === 'rejected' ? `Отказ: ${pending.reason}` : 'Позже'} · {pending.card.title}</span>
    <button class="rounded-lg bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20" type="button" onclick={undo}>Отменить ({undoLeft})</button>
  </div>
{/if}
