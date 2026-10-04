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
let weekPreview = $state(false);
let key = $state('');
let eye = $state(false);
let started = $state(false);
let scrolling = $state(false);
let progress = $state(0);
let shift = $state(0);
let scroller = $state<HTMLDivElement | null>(null);
let left = false;

const demo = $derived(data.demo !== false);
const weekOpen = $derived(demo ? weekPreview : data.weekOpen === true);
const pasted = $derived(demo ? key.trim().length > 0 : data.hasKey === true || key.trim().length > 0);

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
  if (scrolling || scroller === null)
    return;

  scrolling = true;
  scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
}

function track() {
  const node = scroller;
  if (node === null)
    return;

  const top = node.scrollTop;
  const span = Math.max(1, node.scrollHeight - node.clientHeight);
  shift = top * 0.32;
  progress = Math.min(1, top / span);
  if (scrolling && top >= span - 2)
    handoff();
}

function settled() {
  if (scrolling && progress > 0.92)
    handoff();
}

function handoff() {
  if (left === false && scrolling) {
    left = true;
    const jump = () => goto('/admin');
    const view = document as Document & { startViewTransition?: (cb: () => Promise<void>) => void };
    if (view.startViewTransition)
      view.startViewTransition(jump);
    else
      void jump();
  }
}
</script>

<svelte:head>
  <title>Старт</title>
  <link rel="preload" as="image" href="/start-land.jpg" fetchpriority="high" />
  <style>
    html, body { background: #d7e6f3 url('/start-land.jpg') center / cover no-repeat; }
  </style>
</svelte:head>

<div
  class="scroller relative h-dvh overflow-x-hidden overflow-y-auto bg-[#d7e6f3] text-zinc-950"
  bind:this={scroller}
  onscroll={track}
  onscrollend={settled}
>
  <div class="parallax" style:--shift={shift} aria-hidden="true"></div>
  <div class="fog" style:--shift={shift * 0.4} aria-hidden="true"></div>

  <main class="relative z-10 mx-auto flex min-h-[calc(100dvh-5.25rem)] w-full max-w-xl flex-col items-center px-4 pt-[16vh] text-center">
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

    {#if demo && scrolling === false}
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
          {#if demo === false && data.connectUrl.length > 0}
            <a class="mt-4 block break-all text-sm text-zinc-800 underline" href={data.connectUrl}>{data.connectUrl}</a>
          {/if}
          <button class="mt-5 w-full rounded-full bg-black py-3 text-sm font-medium text-white" type="button" onclick={() => finish(2)}>Подключить этот Chrome</button>
        {:else if open === 2}
          <h2 class="text-lg font-semibold">hh</h2>
          <p class="mt-2 text-sm text-zinc-700">В этом же Chrome зайди на hh.ru. Если уже залогинен, просто дальше.</p>
          <button class="mt-5 w-full rounded-full bg-black py-3 text-sm font-medium text-white" type="button" onclick={() => finish(3)}>Я на hh</button>
        {:else if open === 3}
          <h2 class="text-lg font-semibold">Ключ</h2>
          <p class="mt-2 text-sm text-zinc-700">Он нужен, чтобы читать вакансии. Возьми его по кнопке и вставь сюда.</p>
          <a class="mt-4 block w-full rounded-full border border-black/10 bg-white/70 py-3 text-center text-sm" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Взять ключ</a>
          {#if demo}
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
            {#if data.hasKey}
              <p class="mt-3 text-sm text-zinc-700">Ключ уже лежит в аккаунте.</p>
              <button class="mt-4 w-full rounded-full bg-black py-3 text-sm font-medium text-white" type="button" onclick={() => finish(4)}>Дальше</button>
            {/if}
            <form method="POST" action="?/key">
              <label class="mt-3 block text-sm text-zinc-600" for="read-key">Ключ</label>
              <input
                id="read-key"
                name="key"
                class="mt-1 h-11 w-full rounded-xl border border-black/10 bg-white/80 px-3 text-zinc-950 outline-none focus:border-black/30"
                autocomplete="off"
                spellcheck="false"
              />
              <button class="mt-4 w-full rounded-full bg-black py-3 text-sm font-medium text-white" type="submit">{data.hasKey ? 'Заменить' : 'Дальше'}</button>
            </form>
          {/if}
        {:else}
          <h2 class="text-lg font-semibold">Включить</h2>
          {#if weekOpen === false}
            <p class="mt-2 text-sm text-zinc-700">Неделя закрыта. Поиск не стартует.</p>
            <button class="mt-5 w-full rounded-full bg-black py-3 text-sm font-medium text-white opacity-40" type="button" disabled>Включить</button>
            <p class="mt-3 text-center text-sm text-zinc-500">неделя кончилась</p>
          {:else if demo && started}
            <p class="mt-2 text-sm text-emerald-800">Бот включён. Это демка, вкладка hh не открывалась.</p>
          {:else if demo === false && data.hasKey === false}
            <p class="mt-2 text-sm text-zinc-700">Сначала вставь ключ, чтобы читать вакансии.</p>
            <button class="mt-5 w-full rounded-full bg-black py-3 text-sm font-medium text-white opacity-40" type="button" disabled>Включить</button>
          {:else if demo}
            <p class="mt-2 text-sm text-zinc-700">Неделя открыта. Можно включать.</p>
            <button class="mt-5 w-full rounded-full bg-black py-3 text-sm font-medium text-white" type="button" onclick={enable}>Включить</button>
          {:else}
            <p class="mt-2 text-sm text-zinc-700">Неделя открыта. Можно включать.</p>
            <form method="POST" action="?/enable">
              <button class="mt-5 w-full rounded-full bg-black py-3 text-sm font-medium text-white" type="submit">Включить</button>
            </form>
          {/if}
        {/if}
        <button class="mt-3 text-sm text-zinc-600" type="button" onclick={() => go(open === 0 ? null : (open ?? 1) - 1)}>Назад</button>
      </section>
    {/if}
  </main>

  <div class="relative z-10 flex min-h-dvh justify-center">
  <div
    class="admin-shell pointer-events-none"
    style:--p={progress}
    style:view-transition-name={scrolling ? 'admin-app' : undefined}
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
</div>

{#if demo}
<div class="fixed top-5 right-5 z-40">
  {#if eye}
    <div class="mb-2 w-64 rounded-xl border border-amber-400/30 bg-[#1c212b] p-3 text-left text-sm text-zinc-200 shadow-lg">
      <p class="text-xs tracking-wide text-amber-200/80 uppercase">Только тебе</p>
      <p class="mt-1 text-xs text-zinc-400">Ничего не пишется. Чужой аккаунт не открывается. Кнопки листают демку.</p>
      <button class="btn btn-sm mt-3 w-full" type="button" onclick={() => { weekPreview = !weekPreview; started = false; }}>
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
{/if}

<style>
  .scroller {
    scroll-behavior: smooth;
  }

  .parallax {
    position: fixed;
    z-index: 0;
    top: -18%;
    right: 0;
    left: 0;
    height: 150%;
    background: #d7e6f3 url('/start-land.jpg') center / cover no-repeat;
    transform: translate3d(0, calc(var(--shift) * -1px), 0);
    will-change: transform;
    pointer-events: none;
  }

  .fog {
    position: fixed;
    z-index: 1;
    top: -12%;
    right: 0;
    left: 0;
    height: 55%;
    background: linear-gradient(to bottom, rgba(215, 230, 243, 0.72), rgba(215, 230, 243, 0));
    transform: translate3d(0, calc(var(--shift) * -1px), 0);
    pointer-events: none;
  }

  .admin-shell {
    width: calc((1 - var(--p)) * min(1200px, 70vw) + var(--p) * 100%);
    height: 100dvh;
    overflow: hidden;
    border-radius: calc(1.5rem * (1 - var(--p))) calc(1.5rem * (1 - var(--p))) 0 0;
    box-shadow: 0 -18px 50px rgba(15, 23, 42, 0.28);
  }

  @media (max-width: 900px) {
    .admin-shell {
      width: calc((1 - var(--p)) * (100% - 1.5rem) + var(--p) * 100%);
    }
  }
</style>
