<script lang="ts">
import { enhance } from '$app/forms';
import Out from '$lib/Out.svelte';

let { data } = $props();
let openUnlink = $state(false);
let filterDraft = $state('');
let queryMessage = $state('');
let queryOk = $state(false);
let suggesting = $state(false);
const SUGGEST_WAIT_MS = 35_000;
const askName = $derived(data.providers[0]?.name ?? 'модель');
let mustDraft = $state('');
let salaryDraft = $state('');
let blackDraft = $state('');
let corpusMessage = $state('');
let corpusOk = $state(false);
let corpusBrief = $state('');
const savedRaw = $derived(filterRawOf(data.hhQuery, data.stopWords));
const rulesSame = $derived(
  filterDraft === savedRaw
  && mustDraft === data.mustWords
  && salaryDraft === data.salaryMin
  && blackDraft === data.blacklist,
);

function filterRawOf(query: string, stops: string): string {
  const queries = query.split('\n').map(line => line.trim()).filter(line => line.length > 0 && line.startsWith('-') === false);
  const words = stops.split('\n').map(line => line.trim()).filter(line => line.length > 0).map(word => word.startsWith('-') ? word : `-${word}`);

  return [...queries, ...words].join('\n');
}

function stopLines(raw: string): string[] {
  return raw.split('\n').map(line => line.trim()).filter(line => line.startsWith('-') && line.slice(1).trim().length > 0);
}

$effect(() => {
  filterDraft = savedRaw;
  mustDraft = data.mustWords;
  salaryDraft = data.salaryMin;
  blackDraft = data.blacklist;
  corpusBrief = data.corpusBrief;
});
let phrase = $state('');
let resumeOpen = $state(false);
let resumeDraft = $state('');
let resumePhase = $state<'idle' | 'checking' | 'error'>('idle');
let resumeMessage = $state('');

function openResume() {
  resumeOpen = true;
  resumeDraft = `https://hh.ru/resume/${data.resumeId}`;
  resumeMessage = '';
  resumePhase = 'idle';
}
</script>

<header class="mb-5">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">HeadHunter</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Отклики</h1>
</header>

<div class="mb-4 grid gap-3">
  {#if data.resumeId}
    <div class="flex items-center gap-3 rounded-2xl border border-white/8 bg-[#151922] px-4 py-3">
      <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-[#d6001c] text-sm font-semibold text-white">hh</span>
      <div class="min-w-0">
        <a class="block truncate text-sm text-indigo-300 underline-offset-4 hover:underline" href="https://hh.ru/resume/{data.resumeId}" target="_blank" rel="noreferrer">{data.resumeId}</a>
        <p class="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
          <span class="size-1.5 rounded-full bg-emerald-400"></span>
          ссылка есть
        </p>
      </div>
      <button class="ml-auto cursor-pointer rounded-lg px-3 py-1.5 text-sm text-rose-400 transition hover:bg-rose-500 hover:text-white focus-visible:bg-rose-500 focus-visible:text-white focus-visible:outline-none" type="button" onclick={() => { phrase = ''; openUnlink = true; }}>Отвязать</button>
    </div>
  {/if}
</div>

<section class="rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
  <h2 class="text-base font-semibold text-white">Введите ссылку на резюме</h2>
    {#if data.resumeId && resumeOpen === false}
      <div class="mt-4 flex items-end gap-3">
        <div class="flex h-11 min-w-0 flex-1 items-center rounded-lg border border-white/10 bg-black/30 px-3 text-sm">
          <span class="truncate"><span class="text-zinc-500">https://hh.ru/resume/</span><span class="text-zinc-100">{data.resumeId}</span></span>
        </div>
        <button class="btn btn-ghost h-11 min-h-11 px-3" type="button" aria-label="Изменить ссылку" onclick={openResume}>
          <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </button>
      </div>
    {:else}
      <p class="mt-2 text-sm text-zinc-400">Открой <Out href="https://hh.ru/applicant/resumes" text="резюме" />, скопируй адресную строку и вставь сюда.</p>
      {#if resumeMessage}
        <p class="mt-3 font-mono text-xs text-rose-300">{resumeMessage}</p>
      {/if}
      <form
        class="mt-4 flex items-end gap-3"
        method="POST"
        action="?/resume"
        use:enhance={() => {
          resumePhase = 'checking';
          resumeMessage = '';
          return async ({ result, update }) => {
            const body = result.type === 'success' ? result.data : null;
            if (body?.ok === true) {
              resumeOpen = false;
              await update();
              return;
            }

            resumePhase = 'error';
            resumeMessage = typeof body?.detail === 'string' ? body.detail : 'не вышло';
          };
        }}
      >
        <input
          class="input input-bordered h-11 min-w-0 flex-1 border-white/10 bg-black/30 text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-400 focus:outline-none"
          name="hhResumeId"
          autocomplete="off"
          placeholder="https://hh.ru/resume/..."
          readonly={resumePhase === 'checking'}
          bind:value={resumeDraft}
        />
        <button class="btn btn-primary h-11 min-h-11 shrink-0 px-4" type="submit" disabled={resumePhase === 'checking' || resumeDraft.trim().length === 0}>
          {resumePhase === 'checking' ? 'Проверяю' : 'Проверить'}
        </button>
      </form>
    {/if}
</section>

<section class="mt-4 rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
  <h2 class="text-base font-semibold text-white">Фильтрация</h2>
  <p class="mt-2 text-sm text-zinc-400">Одна строка — один поиск. Строка с минусом — стоп-слово, в hh оно не уходит. «Подобрать» собирает запросы, минус-строки остаются.</p>
  {#if queryMessage}
    <p class="mt-3 font-mono text-xs {queryOk ? 'text-emerald-300' : 'text-rose-300'}">{queryMessage}</p>
  {/if}
  <form
    class="mt-4 grid gap-3"
    method="POST"
    action="?/filter"
    use:enhance={({ action, controller }) => {
      queryMessage = '';
      const suggest = action.search === '?/suggest';
      let settled = false;
      let timer = 0;
      if (suggest) {
        suggesting = true;
        timer = window.setTimeout(() => {
          if (settled)
            return;

          settled = true;
          suggesting = false;
          queryOk = false;
          queryMessage = 'модель не ответила, попробуй ещё раз';
          controller.abort();
        }, SUGGEST_WAIT_MS);
      }
      return async ({ result, update }) => {
        if (suggest) {
          if (settled)
            return;

          settled = true;
          window.clearTimeout(timer);
          suggesting = false;
          if (result.type !== 'success') {
            queryOk = false;
            queryMessage = 'сеть отвалилась, попробуй ещё раз';
            return;
          }
        }

        const body = result.type === 'success' ? result.data : null;
        const detail = typeof body?.detail === 'string' ? body.detail : 'не вышло';
        queryOk = body?.ok === true;
        if (suggest) {
          const via = typeof body?.via === 'string' && body.via.length > 0 ? body.via : askName;
          queryMessage = queryOk ? `Подобрал через ${via}, проверь и сохрани` : detail;
          if (queryOk)
            filterDraft = [...detail.split('\n'), ...stopLines(filterDraft)].join('\n');
          return;
        }

        queryMessage = queryOk ? 'Сохранено' : detail;
        if (queryOk)
          await update({ reset: false });
      };
    }}
  >
    <textarea
      class="textarea textarea-bordered min-h-28 w-full border-white/10 bg-black/30 text-sm leading-6 text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-400 focus:outline-none"
      name="filterRaw"
      autocomplete="off"
      placeholder={'Frontend\nReact\n-React Native'}
      bind:value={filterDraft}
    ></textarea>
    <label class="grid gap-1.5">
      <span class="text-sm text-zinc-300">Обязательные слова</span>
      <textarea
        class="textarea textarea-bordered min-h-20 w-full border-white/10 bg-black/30 text-sm leading-6 text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-400 focus:outline-none"
        name="mustWords"
        autocomplete="off"
        placeholder={'typescript\nnestjs'}
        bind:value={mustDraft}
      ></textarea>
    </label>
    <label class="grid gap-1.5">
      <span class="text-sm text-zinc-300">Минимальная зарплата</span>
      <input
        class="input input-bordered h-11 w-full border-white/10 bg-black/30 text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-400 focus:outline-none"
        name="salaryMin"
        inputmode="numeric"
        autocomplete="off"
        placeholder="150000"
        bind:value={salaryDraft}
      />
    </label>
    <label class="grid gap-1.5">
      <span class="text-sm text-zinc-300">Чёрный список компаний</span>
      <textarea
        class="textarea textarea-bordered min-h-20 w-full border-white/10 bg-black/30 text-sm leading-6 text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-400 focus:outline-none"
        name="blacklist"
        autocomplete="off"
        placeholder={'Рога и копыта'}
        bind:value={blackDraft}
      ></textarea>
    </label>
    <div class="flex items-center gap-3">
      <button class="btn btn-primary h-11 min-h-11 px-4" type="submit" disabled={rulesSame || filterDraft.trim().length === 0}>Сохранить</button>
      <button class="btn btn-ghost h-11 min-h-11 px-4" type="submit" formaction="?/suggest" disabled={suggesting}>
        {suggesting ? `Спрашиваю ${askName}…` : 'Подобрать'}
      </button>
    </div>
  </form>
</section>

<section class="mt-4 rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
  <h2 class="text-base font-semibold text-white">Тексты вакансий</h2>
  <p class="mt-2 text-sm text-zinc-400">Выключено и на отклики не влияет. Если включить, скан тихо копит до 100 текстов без компании и ссылки. Потом из них можно собрать выжимку под резюме.</p>
  {#if corpusMessage}
    <p class="mt-3 font-mono text-xs {corpusOk ? 'text-emerald-300' : 'text-rose-300'}">{corpusMessage}</p>
  {/if}
  <form
    class="mt-4 flex items-center gap-3"
    method="POST"
    action="?/corpus"
    use:enhance={() => {
      corpusMessage = '';
      return async ({ result, update }) => {
        const body = result.type === 'success' ? result.data : null;
        corpusOk = body?.ok === true;
        corpusMessage = typeof body?.detail === 'string' ? body.detail : 'не вышло';
        await update({ reset: false });
      };
    }}
  >
    <label class="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
      <input class="checkbox checkbox-sm checkbox-primary" name="hhCorpus" type="checkbox" value="1" checked={data.corpusOn === true} />
      Копить тексты
    </label>
    <button class="btn btn-ghost h-11 min-h-11 px-4" type="submit">Сохранить</button>
    <span class="text-xs text-zinc-500">{data.corpusCount} из 100</span>
  </form>
  {#if data.corpusOn === true && data.corpusCount >= 100}
    <form
      class="mt-3"
      method="POST"
      action="?/distill"
      use:enhance={() => {
        corpusMessage = 'Собираю выжимку';
        return async ({ result }) => {
          const body = result.type === 'success' ? result.data : null;
          corpusOk = body?.ok === true;
          corpusMessage = corpusOk ? 'Выжимка готова' : (typeof body?.detail === 'string' ? body.detail : 'не вышло');
          if (corpusOk && typeof body?.detail === 'string')
            corpusBrief = body.detail;
        };
      }}
    >
      <button class="btn btn-primary h-11 min-h-11 px-4" type="submit">Собрать выжимку</button>
    </form>
  {/if}
  {#if corpusBrief.length > 0}
    <pre class="mt-4 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{corpusBrief}</pre>
  {/if}
</section>

{#if openUnlink}
  <dialog class="modal modal-open">
    <div class="modal-box border border-white/10 bg-[#151922]">
      <form method="POST" action="?/unlink">
        <p class="text-sm leading-6 text-zinc-300">Впиши unlink, чтобы отвязать.</p>
        <input class="input input-bordered mt-4 w-full border-white/10 bg-black/30 focus:border-indigo-400 focus:outline-none" name="phrase" autocomplete="off" bind:value={phrase} />
        <input name="section" type="hidden" value="hh" />
        <div class="mt-5 flex gap-3">
          <button class="btn btn-error" type="submit" disabled={phrase !== 'unlink'}>Отвязать</button>
          <button class="btn btn-ghost" type="button" onclick={() => openUnlink = false}>Закрыть</button>
        </div>
      </form>
    </div>
    <button class="modal-backdrop" type="button" aria-label="Закрыть" onclick={() => openUnlink = false}></button>
  </dialog>
{/if}
