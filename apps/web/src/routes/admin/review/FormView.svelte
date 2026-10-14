<script lang="ts">
import type { DraftRow, FormQuestion } from '@cursor-chrome/hh';

import { isChoice, MULTI_SEP } from '$lib/review-choice';

// One hh-like form. readonly = the AI variant (left column); otherwise the corrected answers (middle).
type Props = {
  cardId: string;
  questions: FormQuestion[];
  drafts: DraftRow[];
  readonly: boolean;
  loading: boolean;
  valueOf: (question: FormQuestion) => string;
  editedOf?: (question: FormQuestion) => boolean;
  onAnswer?: (question: FormQuestion, value: string) => void;
  onUnlink?: (question: FormQuestion, target: string) => void;
  onRule?: (question: FormQuestion) => void;
};

let { cardId, questions, drafts, readonly, loading, valueOf, editedOf = () => false, onAnswer, onUnlink, onRule }: Props = $props();

const draftByPrompt = $derived(new Map(drafts.map(row => [row.prompt, row])));

function picks(answer: string): string[] {
  return answer.split(/\s*;\s*/).map(item => item.trim()).filter(item => item.length > 0);
}

function toggle(question: FormQuestion, current: string[], label: string, on: boolean): string {
  if (question.multi === false)
    return label;

  const next = on ? [...new Set([...current, label])] : current.filter(item => item !== label);

  return question.options.filter(option => next.includes(option)).join(MULTI_SEP);
}

const scope = $derived(readonly ? 'ai' : 'fix');
</script>

<ol class="flex flex-col gap-4">
  {#each questions as question, index (question.prompt)}
    {@const draft = draftByPrompt.get(question.prompt)}
    {@const edited = readonly === false && editedOf(question)}
    {@const missing = draft === undefined || draft.missing}
    <li class={['flex flex-col gap-1.5 rounded-xl', edited ? '-mx-2 bg-amber-400/[0.06] px-2 py-1.5 ring-1 ring-amber-400/60' : '']}>
      <p class="flex items-start gap-2 text-xs text-zinc-300">
        <span class="min-w-0 flex-1"><span class="text-zinc-500">{index + 1}.</span> {question.prompt}{#if question.required}<span class="text-rose-300"> *</span>{/if}</span>
        {#if edited}<span class="shrink-0 rounded-md bg-amber-400/20 px-1.5 py-0.5 text-[11px] font-medium text-amber-200">изменено вручную</span>{/if}
        {#if draft?.model === 'need-human' && valueOf(question).trim().length === 0}<span class="shrink-0 rounded-md bg-rose-400/15 px-1.5 py-0.5 text-[11px] font-medium text-rose-200">нужен твой ответ</span>{/if}
      </p>
      {#if isChoice(question)}
        {@const picked = picks(valueOf(question))}
        <div class={['flex flex-col gap-1 rounded-lg border px-2 py-1.5', readonly ? 'border-white/5 bg-white/[0.02]' : 'border-white/10 bg-[#0b0d12]']} role={question.multi ? 'group' : 'radiogroup'} aria-label={question.prompt}>
          {#each question.choices as choice (choice.value + choice.label)}
            <label class={['flex items-start gap-2 text-xs', readonly ? 'text-zinc-400' : 'cursor-pointer text-zinc-200']}>
              <input class="mt-0.5 accent-indigo-400" type={question.multi ? 'checkbox' : 'radio'} name="{scope}-{cardId}-{index}" disabled={readonly} checked={picked.includes(choice.label)} onchange={event => onAnswer?.(question, toggle(question, picked, choice.label, event.currentTarget.checked))} />
              <span>{choice.label}</span>
            </label>
          {/each}
        </div>
      {:else}
        <textarea
          class={['min-h-16 w-full resize-y rounded-lg border px-2.5 py-2 text-[13px] outline-none', readonly ? 'border-white/5 bg-white/[0.02] text-zinc-400' : 'border-white/10 bg-[#0b0d12] text-zinc-100 focus:border-indigo-400', !readonly && !edited && missing && draft !== undefined ? 'border-amber-400/70' : '']}
          readonly={readonly}
          disabled={readonly}
          placeholder={loading ? 'думает…' : readonly ? 'ИИ не ответил' : 'черновика нет — впиши сам'}
          value={valueOf(question)}
          oninput={event => onAnswer?.(question, event.currentTarget.value)}
        ></textarea>
      {/if}
      {#if readonly}
        {#if valueOf(question).trim().length === 0 && !loading}
          <p class="text-[11px] font-medium text-zinc-400">нет ответа ИИ</p>
        {/if}
        {#if draft?.source}
          <p class="text-[11px] text-sky-300/80">{draft.source.kind === 'canon' ? 'правило' : draft.source.kind === 'profile' ? 'профиль' : draft.source.human ? 'твоя правка' : 'память'}: «{draft.source.from}» · {Math.round(draft.source.score * 100)}%</p>
        {:else if draft && (draft.missing || draft.why)}
          <p class={['text-[11px]', draft.missing ? 'text-amber-300/80' : 'text-zinc-500']}>{draft.missing ? 'не хватает фактов: ' : ''}{draft.why}</p>
        {/if}
      {:else}
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          {#if edited}<span class="text-amber-300">по Ок сохранится в память как твой ответ</span>{/if}
          {#if draft?.source}
            <span class="text-sky-300">{draft.source.kind === 'canon' ? 'правило' : draft.source.kind === 'profile' ? 'профиль' : draft.source.human ? 'твоя правка' : 'память'}: «{draft.source.from}»</span>
            {#if draft.source.kind !== 'profile'}<button class="text-sky-200 underline decoration-dotted hover:text-white" type="button" onclick={() => draft.source && onUnlink?.(question, draft.source.target)}>отвязать</button>{:else}<a class="text-sky-200 underline decoration-dotted hover:text-white" href="/admin/profile">в профиль</a>{/if}
          {/if}
          {#if valueOf(question).trim().length > 0}
            <button class="ml-auto rounded px-1 text-indigo-300 underline decoration-dotted hover:bg-white/10" type="button" title="Создаст или обновит правило: перебивает память и черновик" onclick={() => onRule?.(question)}>запомнить как правило</button>
          {/if}
        </div>
      {/if}
    </li>
  {/each}
</ol>
