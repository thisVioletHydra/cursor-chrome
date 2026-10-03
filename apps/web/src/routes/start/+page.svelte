<script lang="ts">
import { goto } from '$app/navigation';
import NavIcon from '../admin/NavIcon.svelte';

const steps = [
  { chip: 'Шаг 1', name: 'Вход' },
  { chip: 'Шаг 2', name: 'Браузер' },
  { chip: 'Шаг 3', name: 'hh' },
  { chip: 'Шаг 4', name: 'Ключ' },
] as const;

const nav = [
  ['Главная', 'home'],
  ['Telegram', 'plane'],
  ['Модель', 'spark'],
  ['HeadHunter', 'briefcase'],
  ['Extension', 'puzzle'],
  ['Сопроводительное', 'letter'],
  ['ATS', 'doc'],
  ['Billing', 'card'],
  ['Конфиг', 'file'],
  ['Имитация', 'person'],
] as const;

let { data } = $props();
let open = $state<number | null>(null);
let cleared = $state(0);
let weekOpen = $state(false);
let key = $state('');
let eye = $state(false);
let started = $state(false);
let rising = $state(false);
let left = false;

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

function pass() {
  if (rising)
    return;

  rising = true;
}

function arrived(event: TransitionEvent) {
  if (left || rising === false || event.target !== event.currentTarget || event.propertyName !== 'transform')
    return;

  left = true;
  const jump = () => goto('/admin');
  const view = document as Document & { startViewTransition?: (cb: () => Promise<void>) => void };
  if (view.startViewTransition)
    view.startViewTransition(jump);
  else
    void jump();
}
</script>

<svelte:head>
  <title>Старт</title>
  <link rel="preload" as="image" href="/start-land.jpg" fetchpriority="high" />
  <style>
    html, body { background: #d7e6f3 url('/start-land.jpg') center / cover no-repeat; }
  </style>
</svelte:head>

<div class="relative min-h-dvh overflow-hidden bg-[#d7e6f3] bg-cover bg-center text-zinc-950" style="background-image: url('/start-land.jpg')">

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

    {#if rising === false}
      <button
        class="mt-4 rounded-full border border-white/50 bg-black/35 px-4 py-2 text-sm text-white shadow-sm backdrop-blur-md transition hover:bg-black/50"
        type="button"
        onclick={pass}
      >
        Мы авторизовались · PASS
      </button>
    {/if}

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

  <div
    class="admin-rise pointer-events-none fixed bottom-0 z-30"
    class:up={rising}
    style:view-transition-name={rising ? 'admin-app' : undefined}
    ontransitionend={arrived}
    aria-hidden="true"
  >
    <div class="grid h-full grid-cols-[200px_1fr] overflow-hidden bg-[#0b0d12] text-zinc-100">
      <aside class="flex h-full flex-col overflow-hidden border-r border-white/8 bg-[#10131a] px-4 py-6">
        <nav class="flex flex-col gap-1">
          {#each nav as item, index (item[0])}
            <span class="flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-sm {index === 0 ? 'bg-indigo-500/30 text-white ring-1 ring-inset ring-indigo-400/60' : 'text-zinc-400'}">
              <NavIcon name={item[1]} class={index === 0 ? 'text-indigo-300' : ''} />
              <span class="min-w-0 flex-1 truncate">{item[0]}</span>
            </span>
          {/each}
        </nav>
        <span class="mt-auto flex items-center gap-2 rounded-xl px-2 py-2">
          <svg class="size-5 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8" />
          </svg>
          <span class="min-w-0 flex-1 truncate text-sm text-zinc-200">{data.login}</span>
        </span>
      </aside>
      <div class="px-5 py-6 lg:px-10 lg:py-8">
        <p class="text-xs tracking-wide text-zinc-500 uppercase">Обзор</p>
        <h2 class="mt-1 text-3xl font-semibold tracking-tight">Сервисы</h2>
      </div>
    </div>
  </div>
</div>

<div class="fixed top-5 right-5 z-40">
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

<style>
  .admin-rise {
    left: 50%;
    width: min(1200px, 70vw);
    height: 100dvh;
    transform: translate(-50%, calc(100% - 5.25rem));
    transition: transform 0.9s cubic-bezier(0.22, 1, 0.36, 1), border-radius 0.9s ease;
    border-radius: 1.5rem 1.5rem 0 0;
    overflow: hidden;
    box-shadow: 0 -18px 50px rgba(15, 23, 42, 0.28);
  }

  @media (max-width: 900px) {
    .admin-rise {
      width: calc(100% - 1.5rem);
    }
  }

  .admin-rise.up {
    transform: translate(-50%, 0);
    border-radius: 0;
  }
</style>
