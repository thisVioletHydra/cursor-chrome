<script lang="ts">
import KeyConnect from '$lib/KeyConnect.svelte';
import Mark from '$lib/Mark.svelte';
import Out from '$lib/Out.svelte';

let { data } = $props();
const link = $derived(data.links.find(item => item.name === 'Телега'));
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
  <h2 class="text-base font-semibold text-white">Где взять токен</h2>
  <ol class="mt-4 list-decimal space-y-4 pl-5">
    <li>Открой <Out href="https://t.me/BotFather" text="@BotFather" /> в Telegram.</li>
    <li>Бота ещё нет: отправь <Mark text="/newbot" />. Имя любое. Username обязан кончаться на <Mark text="bot" />, например <Mark text="hh_roman_bot" />.</li>
    <li>Бот уже есть: <Mark text="/mybots" />, выбери бота, потом <Mark text="API Token" />.</li>
    <li>Строка вида <Mark text="7123456789:AAHxx-пример-не-настоящий" />. Это не chat id.</li>
    <li>Вставь в поле и нажми <Mark text="Проверить" />.</li>
  </ol>
  <h2 class="mt-8 text-base font-semibold text-white">Как проверить, что бот живой</h2>
  <ol class="mt-4 list-decimal space-y-4 pl-5">
    <li>Напиши боту в личку с аккаунта <Mark text="@rtxRoman" />. Первое сообщение привязывает чат.</li>
    <li>Команды текстом: <Mark text="старт" /> и <Mark text="стоп" />.</li>
    <li>Когда проверка проходит, поле закрывается и в статусе написано, что токен активирован.</li>
  </ol>
</section>
