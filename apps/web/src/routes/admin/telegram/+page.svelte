<script lang="ts">
import KeyConnect from '$lib/KeyConnect.svelte';
import Mark from '$lib/Mark.svelte';
import Out from '$lib/Out.svelte';

let { data } = $props();
const link = $derived(data.links.find(item => item.name === 'Телега'));
const username = $derived(link?.detail.match(/@([A-Za-z0-9_]+)/)?.[1] ?? '');
</script>

<header class="mb-8">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Telegram</p>
  <h1 class="mt-2 text-3xl font-semibold tracking-tight">Бот</h1>
</header>

<KeyConnect
  section="telegram"
  active={link?.ok === true}
  detail={link?.detail ?? ''}
  wait={data.locks.telegram}
  fields={[{ name: 'telegramToken', label: 'Токен бота', secret: true }]}
/>

<section class="mt-8 rounded-2xl border border-white/8 bg-[#151922] p-7 text-sm leading-7 text-zinc-300">
  <ol class="list-decimal space-y-4 pl-5">
    <li>Жми <Out href="https://t.me/BotFather" text="@BotFather" />.</li>
    <li>Бота нет: отправь <Mark text="/newbot" />. Бот есть: <Mark text="/mybots" />, потом <Mark text="API Token" />.</li>
    <li>Скопируй токен, вставь в поле сверху, жми <Mark text="Проверить" />.</li>
  </ol>
  {#if username}
    <p class="mt-6">Дальше одна кнопка. Откроется чат, бот сам напишет, что нажимать.</p>
    <a class="btn btn-primary mt-4 h-12 min-h-12 px-5" href="https://t.me/{username}?start=1" target="_blank" rel="noreferrer">Открыть бота</a>
  {/if}
</section>
