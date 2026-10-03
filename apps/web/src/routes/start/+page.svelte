<script lang="ts">
const steps = [
  { chip: 'Шаг 1', name: 'Вход' },
  { chip: 'Шаг 2', name: 'Браузер' },
  { chip: 'Шаг 3', name: 'hh' },
  { chip: 'Шаг 4', name: 'Ключ' },
] as const;

const figures = [
  ['Откликнуться', '0'],
  ['В очереди', '0'],
  ['Ждут тебя', '0'],
  ['Приглашения', '0'],
  ['Отказы', '0'],
  ['Скрытые', '0'],
] as const;

let open = $state<number | null>(null);
let cleared = $state(0);
let weekOpen = $state(false);
let key = $state('');
let eye = $state(false);
let started = $state(false);

const pasted = $derived(key.trim().length > 0);

function go(next: number | null) {
  started = false;
  open = next;
}

function finish(next: number) {
  started = false;
  cleared = Math.max(cleared, next);
  open = next;
}

function begin() {
  started = false;
  open = cleared >= steps.length ? steps.length : cleared;
}

function enable() {
  if (weekOpen === false || pasted === false)
    return;

  started = true;
}
</script>

<svelte:head>
  <title>Старт</title>
</svelte:head>

<div class="relative min-h-dvh overflow-hidden text-zinc-950">
  <img class="absolute inset-0 h-full w-full object-cover" src="/start-land.jpg" alt="" />

  <header class="absolute top-0 left-0 z-20 p-5">
    <span class="grid size-8 place-items-center rounded-full bg-black text-white" aria-hidden="true">
      <svg class="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
        <circle cx="8" cy="8" r="5.2" />
        <path d="M8 4.8v3.4l2.2 1.3" />
      </svg>
    </span>
  </header>

  <main class="relative z-10 mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center px-4 pt-[16vh] pb-36 text-center">
    {#if open === null}
      <h1 class="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Подключение</h1>
      <p class="mt-4 max-w-md text-base text-zinc-800">Поиск включится, когда неделя открыта.</p>
      <button
        class="mt-8 rounded-full bg-black px-8 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-zinc-800"
        type="button"
        onclick={begin}
      >
        Старт
      </button>
    {/if}

    <ol class="mt-8 flex flex-wrap justify-center gap-2">
      {#each steps as item, index (item.chip)}
        <li>
          <button
            class="rounded-full border border-white/50 bg-black/35 px-3.5 py-1.5 text-sm text-white shadow-sm backdrop-blur-md transition hover:bg-black/50 {open === index ? 'bg-black/55' : ''}"
            type="button"
            aria-label="{item.chip}. {item.name}"
            onclick={() => go(index)}
          >
            {item.chip}
          </button>
        </li>
      {/each}
    </ol>

    {#if open !== null}
      <section class="mt-5 w-full rounded-3xl border border-white/70 bg-white/75 px-5 py-5 text-left shadow-xl backdrop-blur-xl">
        {#if open === 0}
          <h2 class="text-lg font-semibold">Вход</h2>
          <p class="mt-2 text-sm text-zinc-700">Один раз через GitHub. Пароль hh сюда не вводится.</p>
          <button class="mt-5 w-full rounded-full bg-black py-3 text-sm font-medium text-white" type="button" onclick={() => finish(1)}>Войти через GitHub</button>
        {:else if open === 1}
          <h2 class="text-lg font-semibold">Браузер</h2>
          <p class="mt-2 text-sm text-zinc-700">Поставь расширение и открой одну ссылку. Она привяжет этот Chrome.</p>
          <button class="mt-5 w-full rounded-full bg-black py-3 text-sm font-medium text-white" type="button" onclick={() => finish(2)}>Подключить этот Chrome</button>
        {:else if open === 2}
          <h2 class="text-lg font-semibold">hh</h2>
          <p class="mt-2 text-sm text-zinc-700">В этом же Chrome зайди на hh.ru. Если уже залогинен, просто дальше.</p>
          <button class="mt-5 w-full rounded-full bg-black py-3 text-sm font-medium text-white" type="button" onclick={() => finish(3)}>Я на hh</button>
        {:else if open === 3}
          <h2 class="text-lg font-semibold">Ключ</h2>
          <p class="mt-2 text-sm text-zinc-700">Он нужен, чтобы читать вакансии. Возьми его по кнопке и вставь сюда.</p>
          <a class="mt-4 block w-full rounded-full border border-black/10 bg-white/70 py-3 text-center text-sm" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Взять ключ</a>
          <label class="mt-3 block text-sm text-zinc-600" for="read-key">Ключ</label>
          <input
            id="read-key"
            class="mt-1 h-11 w-full rounded-xl border border-black/10 bg-white/80 px-3 text-zinc-950 outline-none focus:border-black/30"
            autocomplete="off"
            spellcheck="false"
            bind:value={key}
          />
          <button class="mt-4 w-full rounded-full bg-black py-3 text-sm font-medium text-white disabled:opacity-40" type="button" disabled={pasted === false} onclick={() => finish(4)}>Дальше</button>
        {:else}
          <h2 class="text-lg font-semibold">Включить</h2>
          {#if weekOpen === false}
            <p class="mt-2 text-sm text-zinc-700">Неделя закрыта. Поиск не стартует.</p>
            <button class="mt-5 w-full rounded-full bg-black py-3 text-sm font-medium text-white opacity-40" type="button" disabled>Включить</button>
            <p class="mt-3 text-center text-sm text-zinc-500">неделя кончилась</p>
          {:else if started}
            <p class="mt-2 text-sm text-emerald-800">Бот включён. Это демка, вкладка hh не открывалась.</p>
          {:else}
            <p class="mt-2 text-sm text-zinc-700">Неделя открыта. Можно включать.</p>
            <button class="mt-5 w-full rounded-full bg-black py-3 text-sm font-medium text-white" type="button" onclick={enable}>Включить</button>
          {/if}
        {/if}
        <button class="mt-3 text-sm text-zinc-600" type="button" onclick={() => go(open === 0 ? null : (open ?? 1) - 1)}>Назад</button>
      </section>
    {/if}
  </main>

  <div class="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center" aria-hidden="true">
    <div class="w-[min(56rem,94vw)] translate-y-[78%] rounded-t-3xl border border-white/80 bg-white/85 px-4 pt-4 shadow-[0_-12px_40px_rgba(15,23,42,0.18)] backdrop-blur-xl">
      <div class="flex divide-x divide-black/10 overflow-hidden rounded-xl border border-black/10 bg-white/70">
        {#each figures as figure (figure[0])}
          <div class="flex min-w-0 flex-1 flex-col items-center gap-1 px-2 py-2">
            <span class="text-center text-[10px] leading-none text-zinc-500">{figure[0]}</span>
            <span class="text-sm leading-none font-semibold tabular-nums">{figure[1]}</span>
          </div>
        {/each}
      </div>
      <h2 class="mt-3 text-left text-base font-semibold">Логирование</h2>
    </div>
  </div>
</div>

<div class="fixed right-3 bottom-28 z-40">
  {#if eye}
    <div class="mb-2 w-64 rounded-xl border border-amber-400/30 bg-[#1c212b] p-3 text-left text-sm text-zinc-200 shadow-lg">
      <p class="text-xs tracking-wide text-amber-200/80 uppercase">Только тебе</p>
      <p class="mt-1 text-xs text-zinc-400">Ничего не пишется. Чужой аккаунт не открывается. Кнопки листают демку.</p>
      <button class="btn btn-sm mt-3 w-full" type="button" onclick={() => { weekOpen = !weekOpen; started = false; }}>
        {weekOpen ? 'Неделя открыта' : 'Неделя закрыта'}
      </button>
      <div class="mt-2 flex flex-wrap gap-1">
        {#each steps as item, index (item.chip)}
          <button class="btn btn-xs" type="button" onclick={() => go(index)}>{item.chip}</button>
        {/each}
        <button class="btn btn-xs" type="button" onclick={() => go(4)}>Включить</button>
      </div>
    </div>
  {/if}
  <button
    class="btn btn-sm border border-amber-400/40 bg-[#1c212b] text-amber-100"
    type="button"
    aria-expanded={eye}
    onclick={() => eye = !eye}
  >
    Глаз
  </button>
</div>
