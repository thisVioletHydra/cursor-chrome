<script lang="ts">
import KeyConnect from '$lib/KeyConnect.svelte';
import Mark from '$lib/Mark.svelte';
import Out from '$lib/Out.svelte';

let { data } = $props();
const link = $derived(data.links.find(item => item.name === 'Телега'));
const username = $derived(link?.detail.match(/@([A-Za-z0-9_]+)/)?.[1] ?? '');
let ask = $state(false);
</script>

<header class="mb-5">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Telegram</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Бот</h1>
</header>

{#if link?.ok && username}
  <div class="flex items-center gap-3 rounded-2xl border border-white/8 bg-[#151922] px-4 py-3">
    <svg class="size-9 shrink-0 text-sky-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.5 4.3 2.7 11.5c-1.3.5-1.3 1.2-.2 1.5l4.8 1.5 1.9 5.8c.2.7.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.2-.5-1.8-1.4-1.3M8.8 14.6l9.3-5.9c.5-.3.9-.1.5.2l-7.6 6.9-.3 3.2z" />
    </svg>
    <div class="min-w-0">
      <a class="block truncate text-sm text-indigo-300 underline-offset-4 hover:underline" href="https://t.me/{username}" target="_blank" rel="noreferrer">@{username}</a>
      <p class="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
        <span class="size-1.5 rounded-full bg-emerald-400"></span>
        активирован
      </p>
    </div>
    <button class="ml-auto rounded-lg px-3 py-1.5 text-sm text-rose-400 transition hover:bg-rose-500 hover:text-white focus-visible:bg-rose-500 focus-visible:text-white focus-visible:outline-none" type="button" onclick={() => ask = true}>Отвязать</button>
  </div>
{/if}

<KeyConnect
  section="telegram"
  active={link?.ok === true}
  detail={link?.detail ?? ''}
  wait={data.locks.telegram}
  fields={[{ name: 'telegramToken', label: 'Токен бота', secret: true }]}
  showActive={false}
  bind:ask
/>

<section class="mt-4 rounded-2xl border border-white/8 bg-[#151922] px-5 py-4 text-sm leading-6 text-zinc-300">
  <ol class="list-decimal space-y-2 pl-5">
    <li>Жми <Out href="https://t.me/BotFather" text="@BotFather" />.</li>
    <li>Бота нет: отправь <Mark text="/newbot" />. Бот есть: <Mark text="/mybots" />, потом <Mark text="API Token" />.</li>
    <li>Скопируй токен, вставь в поле сверху, жми <Mark text="Проверить" />.</li>
  </ol>
</section>
