<script lang="ts">
import KeyConnect from '$lib/KeyConnect.svelte';
import Mark from '$lib/Mark.svelte';
import Out from '$lib/Out.svelte';

let { data } = $props();
const link = $derived(data.links.find(item => item.name === 'Телега'));
const username = $derived(link?.detail.match(/@([A-Za-z0-9_]+)/)?.[1] ?? '');
</script>

<header class="mb-5">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Telegram</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Бот</h1>
</header>

<KeyConnect
  section="telegram"
  active={link?.ok === true}
  detail={link?.detail ?? ''}
  wait={data.locks.telegram}
  fields={[{ name: 'telegramToken', label: 'Токен бота', secret: true }]}
  actionHref={username ? `https://t.me/${username}?start=1` : ''}
  actionLabel="Открыть бота"
/>

<section class="mt-4 rounded-2xl border border-white/8 bg-[#151922] px-5 py-4 text-sm leading-6 text-zinc-300">
  <ol class="list-decimal space-y-2 pl-5">
    <li>Жми <Out href="https://t.me/BotFather" text="@BotFather" />.</li>
    <li>Бота нет: отправь <Mark text="/newbot" />. Бот есть: <Mark text="/mybots" />, потом <Mark text="API Token" />.</li>
    <li>Скопируй токен, вставь в поле сверху, жми <Mark text="Проверить" />.</li>
  </ol>
</section>
