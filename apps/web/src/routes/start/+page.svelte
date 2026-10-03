<script lang="ts">
const steps = ['Вход', 'Браузер', 'hh', 'Ключ'] as const;

let step = $state(0);
let weekOpen = $state(false);
let key = $state('');
let eye = $state(false);
let started = $state(false);

const pasted = $derived(key.trim().length > 0);
const last = $derived(step >= steps.length);

function go(next: number) {
  started = false;
  step = Math.min(Math.max(next, 0), steps.length);
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

<div class="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Старт</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Подключение</h1>
  <p class="mt-2 text-sm text-zinc-400">Четыре шага. Поиск включится, когда неделя открыта.</p>

  <ol class="mt-6 flex gap-2">
    {#each steps as label, index (label)}
      <li class="flex-1">
        <button
          class="w-full rounded-full px-2 py-1 text-xs {index === step ? 'bg-white text-zinc-900' : index < step ? 'bg-white/15 text-zinc-200' : 'bg-white/5 text-zinc-500'}"
          type="button"
          onclick={() => go(index)}
        >
          {label}
        </button>
      </li>
    {/each}
  </ol>

  <section class="mt-4 rounded-2xl border border-white/8 bg-[#151922] px-5 py-5">
    {#if step === 0}
      <h2 class="text-lg font-semibold">Вход</h2>
      <p class="mt-2 text-sm text-zinc-400">Один раз через GitHub. Пароль hh сюда не вводится.</p>
      <button class="btn btn-primary mt-5 w-full" type="button" onclick={() => go(1)}>Войти через GitHub</button>
    {:else if step === 1}
      <h2 class="text-lg font-semibold">Браузер</h2>
      <p class="mt-2 text-sm text-zinc-400">Поставь расширение и открой одну ссылку. Она привяжет этот Chrome.</p>
      <button class="btn btn-primary mt-5 w-full" type="button" onclick={() => go(2)}>Подключить этот Chrome</button>
    {:else if step === 2}
      <h2 class="text-lg font-semibold">hh</h2>
      <p class="mt-2 text-sm text-zinc-400">В этом же Chrome зайди на hh.ru. Если уже залогинен, просто дальше.</p>
      <button class="btn btn-primary mt-5 w-full" type="button" onclick={() => go(3)}>Я на hh</button>
    {:else if step === 3}
      <h2 class="text-lg font-semibold">Ключ</h2>
      <p class="mt-2 text-sm text-zinc-400">Он нужен, чтобы читать вакансии. Возьми его по кнопке и вставь сюда.</p>
      <a class="btn btn-ghost mt-4 w-full" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Взять ключ</a>
      <label class="mt-3 block text-sm text-zinc-400" for="read-key">Ключ</label>
      <input
        id="read-key"
        class="input input-bordered mt-1 h-11 w-full border-white/10 bg-black/30 text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-400 focus:outline-none"
        autocomplete="off"
        spellcheck="false"
        bind:value={key}
      />
      <button class="btn btn-primary mt-4 w-full" type="button" disabled={pasted === false} onclick={() => go(4)}>Дальше</button>
    {:else}
      <h2 class="text-lg font-semibold">Включить</h2>
      {#if weekOpen === false}
        <p class="mt-2 text-sm text-zinc-400">Неделя закрыта. Поиск не стартует.</p>
        <button class="btn mt-5 w-full" type="button" disabled>Включить</button>
        <p class="mt-3 text-center text-sm text-zinc-500">неделя кончилась</p>
      {:else if started}
        <p class="mt-2 text-sm text-emerald-300">Бот включён. Это демка, вкладка hh не открывалась.</p>
      {:else}
        <p class="mt-2 text-sm text-zinc-400">Неделя открыта. Можно включать.</p>
        <button class="btn btn-primary mt-5 w-full" type="button" onclick={enable}>Включить</button>
      {/if}
    {/if}
  </section>

  {#if step > 0 && last === false}
    <button class="btn btn-ghost mt-3 self-start" type="button" onclick={() => go(step - 1)}>Назад</button>
  {/if}
</div>

<div class="fixed right-3 bottom-3 z-40">
  {#if eye}
    <div class="mb-2 w-64 rounded-xl border border-amber-400/30 bg-[#1c212b] p-3 text-sm shadow-lg">
      <p class="text-xs tracking-wide text-amber-200/80 uppercase">Только тебе</p>
      <p class="mt-1 text-xs text-zinc-400">Ничего не пишется. Чужой аккаунт не открывается. Кнопки листают демку.</p>
      <button class="btn btn-sm mt-3 w-full" type="button" onclick={() => { weekOpen = !weekOpen; started = false; }}>
        {weekOpen ? 'Неделя открыта' : 'Неделя закрыта'}
      </button>
      <div class="mt-2 flex flex-wrap gap-1">
        {#each steps as label, index (label)}
          <button class="btn btn-xs" type="button" onclick={() => go(index)}>{label}</button>
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
