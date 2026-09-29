<script lang="ts">
import { enhance } from '$app/forms';

let { data } = $props();
let pace = $state({ ...data.pace });
let saving = $state(false);
let message = $state('');
let ok = $state(false);

$effect(() => {
  pace = { ...data.pace };
});

const steps = $derived([
  {
    title: 'Открыть вакансию',
    note: '',
    lines: [] as string[],
    gap: teaSentence(pace.teaEvery, pace.teaMin, pace.teaMax),
  },
  {
    title: 'Читать',
    note: 'Ничего не нажимать.',
    lines: [
      readSentence(pace.readMin, pace.readMax),
      fastSentence(pace.fastEvery, pace.fastMin, pace.fastMax),
    ],
    gap: '',
  },
  {
    title: 'Нужен человек',
    note: 'Шарады, ребусы или мутная цыганщина в тексте или в форме — не откликаться.',
    lines: [],
    gap: '',
  },
  {
    title: 'Выбрать резюме',
    note: 'Фронтенд — резюме фронтенда. Бэкенд и фуллстек — фуллстек.',
    lines: [],
    gap: '',
  },
  {
    title: 'Письмо и отклик',
    note: 'Вставить сопроводительное и откликнуться.',
    lines: [],
    gap: '',
  },
  {
    title: 'Отвлечься',
    note: 'Перед следующей.',
    lines: [afterSentence(pace.distractMin, pace.distractMax)],
    gap: '',
  },
]);

function ordered(min: number, max: number): [number, number] | null {
  if (Number.isInteger(min) === false || Number.isInteger(max) === false)
    return null;

  return min <= max ? [min, max] : [max, min];
}

function ru(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 > 10 && mod100 < 20)
    return many;

  if (mod10 > 1 && mod10 < 5)
    return few;

  if (mod10 === 1)
    return one;

  return many;
}

function vacancies(n: number): string {
  return ru(n, 'вакансию', 'вакансии', 'вакансий');
}

function span(lo: number, hi: number, unit: string): string {
  return lo === hi ? `${lo} ${unit}` : `${lo}–${hi} ${unit}`;
}

function secondsSpan(min: number, max: number): string | null {
  const pair = ordered(min, max);
  if (pair === null)
    return null;

  const [lo, hi] = pair;

  return span(lo, hi, ru(hi, 'секунду', 'секунды', 'секунд'));
}

function readSentence(min: number, max: number): string {
  const pair = ordered(min, max);
  if (pair === null)
    return '—';

  const [lo, hi] = pair;

  return `Ничего не нажимает от ${lo} до ${hi} ${ru(hi, 'секунды', 'секунд', 'секунд')}`;
}

function fastSentence(every: number, min: number, max: number): string {
  const wait = secondsSpan(min, max);
  if (Number.isInteger(every) === false || every < 1 || wait === null)
    return '—';

  return `Редко, примерно раз на ${every} ${vacancies(every)}, пролистывает за ${wait} и почти не читает.`;
}

function teaSpan(min: number, max: number): string | null {
  const pair = ordered(min, max);
  if (pair === null)
    return null;

  const [lo, hi] = pair;
  if (lo % 60 === 0 && hi % 60 === 0) {
    const a = lo / 60;
    const b = hi / 60;

    return span(a, b, ru(b, 'минуту', 'минуты', 'минут'));
  }

  return secondsSpan(lo, hi);
}

function teaSentence(every: number, min: number, max: number): string {
  const wait = teaSpan(min, max);
  if (Number.isInteger(every) === false || every < 1 || wait === null)
    return '—';

  return `Редко, примерно раз на ${every} ${vacancies(every)}, уходит на ${wait}.`;
}

function afterSentence(min: number, max: number): string {
  const wait = secondsSpan(min, max);
  if (wait === null)
    return '—';

  return `После отклика отвлекается на ${wait}`;
}

function detailOf(data: unknown): { ok: boolean; detail: string } {
  if (typeof data !== 'object' || data === null || 'ok' in data === false)
    return { ok: false, detail: 'не вышло' };

  const detail = 'detail' in data && typeof data.detail === 'string' ? data.detail : 'не вышло';

  return { ok: data.ok === true, detail };
}

function onSave() {
  saving = true;
  message = '';

  return async ({ result, update }) => {
    const parsed = detailOf(result.type === 'success' ? result.data : null);
    ok = parsed.ok;
    message = parsed.detail;
    try {
      if (ok)
        await update({ reset: false });
    }
    finally {
      saving = false;
    }
  };
}
</script>

<header class="mb-5">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">HeadHunter</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Имитация</h1>
</header>

<section class="rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
  <h2 class="text-base font-semibold text-white">Маршрут</h2>
  <ol class="mt-4">
    {#each steps as step, index}
      <li class="grid grid-cols-[1.75rem_1fr] gap-3">
        <div class="flex flex-col items-center">
          <span class="grid size-7 place-items-center rounded-full border border-white/15 bg-white/5 text-xs text-zinc-200">{index + 1}</span>
          {#if index < steps.length - 1}
            <span class="my-1 w-px flex-1 bg-white/10"></span>
          {/if}
        </div>
        <div class={index < steps.length - 1 ? 'pb-4' : ''}>
          <p class="text-sm font-medium text-white">{step.title}</p>
          {#if step.note}
            <p class="mt-1 text-sm text-zinc-400">{step.note}</p>
          {/if}
          {#each step.lines as line}
            <p class="mt-1 text-sm leading-snug text-indigo-200">{line}</p>
          {/each}
          {#if step.gap}
            <p class="mt-2 text-sm leading-snug text-amber-200/90">{step.gap}</p>
          {/if}
        </div>
      </li>
    {/each}
  </ol>
</section>

<section class="mt-4 rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
  <h2 class="text-base font-semibold text-white">Паузы</h2>
  <form
    class="mt-4 grid gap-4"
    method="POST"
    action="?/save"
    use:enhance={onSave}
  >
    <fieldset class="grid gap-2">
      <legend class="text-sm text-zinc-300">Чтение</legend>
      <div class="flex gap-2">
        <label class="grid gap-1 text-xs text-zinc-500">
          от, секунды
          <input class="input input-bordered h-11 w-24 border-white/10 bg-black/30 text-center text-sm text-zinc-100 focus:border-indigo-400 focus:outline-none" name="readMin" type="number" min="0" max="600" step="1" inputmode="numeric" autocomplete="off" bind:value={pace.readMin} />
        </label>
        <label class="grid gap-1 text-xs text-zinc-500">
          до, секунды
          <input class="input input-bordered h-11 w-24 border-white/10 bg-black/30 text-center text-sm text-zinc-100 focus:border-indigo-400 focus:outline-none" name="readMax" type="number" min="0" max="600" step="1" inputmode="numeric" autocomplete="off" bind:value={pace.readMax} />
        </label>
      </div>
    </fieldset>
    <fieldset class="grid gap-2">
      <legend class="text-sm text-zinc-300">После отклика</legend>
      <div class="flex gap-2">
        <label class="grid gap-1 text-xs text-zinc-500">
          от, секунды
          <input class="input input-bordered h-11 w-24 border-white/10 bg-black/30 text-center text-sm text-zinc-100 focus:border-indigo-400 focus:outline-none" name="distractMin" type="number" min="0" max="600" step="1" inputmode="numeric" autocomplete="off" bind:value={pace.distractMin} />
        </label>
        <label class="grid gap-1 text-xs text-zinc-500">
          до, секунды
          <input class="input input-bordered h-11 w-24 border-white/10 bg-black/30 text-center text-sm text-zinc-100 focus:border-indigo-400 focus:outline-none" name="distractMax" type="number" min="0" max="600" step="1" inputmode="numeric" autocomplete="off" bind:value={pace.distractMax} />
        </label>
      </div>
    </fieldset>
    <fieldset class="grid gap-2">
      <legend class="text-sm text-zinc-300">Уходит</legend>
      <div class="flex flex-wrap gap-2">
        <label class="grid gap-1 text-xs text-zinc-500">
          раз на, вакансий
          <input class="input input-bordered h-11 w-24 border-white/10 bg-black/30 text-center text-sm text-zinc-100 focus:border-indigo-400 focus:outline-none" name="teaEvery" type="number" min="1" max="100" step="1" inputmode="numeric" autocomplete="off" bind:value={pace.teaEvery} />
        </label>
        <label class="grid gap-1 text-xs text-zinc-500">
          от, секунды
          <input class="input input-bordered h-11 w-24 border-white/10 bg-black/30 text-center text-sm text-zinc-100 focus:border-indigo-400 focus:outline-none" name="teaMin" type="number" min="0" max="600" step="1" inputmode="numeric" autocomplete="off" bind:value={pace.teaMin} />
        </label>
        <label class="grid gap-1 text-xs text-zinc-500">
          до, секунды
          <input class="input input-bordered h-11 w-24 border-white/10 bg-black/30 text-center text-sm text-zinc-100 focus:border-indigo-400 focus:outline-none" name="teaMax" type="number" min="0" max="600" step="1" inputmode="numeric" autocomplete="off" bind:value={pace.teaMax} />
        </label>
      </div>
    </fieldset>
    <fieldset class="grid gap-2">
      <legend class="text-sm text-zinc-300">Пролистывает</legend>
      <div class="flex flex-wrap gap-2">
        <label class="grid gap-1 text-xs text-zinc-500">
          раз на, вакансий
          <input class="input input-bordered h-11 w-24 border-white/10 bg-black/30 text-center text-sm text-zinc-100 focus:border-indigo-400 focus:outline-none" name="fastEvery" type="number" min="1" max="100" step="1" inputmode="numeric" autocomplete="off" bind:value={pace.fastEvery} />
        </label>
        <label class="grid gap-1 text-xs text-zinc-500">
          от, секунды
          <input class="input input-bordered h-11 w-24 border-white/10 bg-black/30 text-center text-sm text-zinc-100 focus:border-indigo-400 focus:outline-none" name="fastMin" type="number" min="0" max="600" step="1" inputmode="numeric" autocomplete="off" bind:value={pace.fastMin} />
        </label>
        <label class="grid gap-1 text-xs text-zinc-500">
          до, секунды
          <input class="input input-bordered h-11 w-24 border-white/10 bg-black/30 text-center text-sm text-zinc-100 focus:border-indigo-400 focus:outline-none" name="fastMax" type="number" min="0" max="600" step="1" inputmode="numeric" autocomplete="off" bind:value={pace.fastMax} />
        </label>
      </div>
    </fieldset>
    <div class="flex flex-wrap items-center gap-3">
      <button
        class="btn btn-primary h-11 min-h-11 px-4 active:scale-[0.97] disabled:cursor-wait disabled:opacity-60"
        type="submit"
        disabled={saving}
        aria-busy={saving}
      >{saving ? 'Сохраняю…' : 'Сохранить'}</button>
      {#if message}
        <p class="text-sm {ok ? 'text-emerald-300' : 'text-rose-300'}" aria-live="polite">{message}</p>
      {/if}
    </div>
  </form>
</section>
