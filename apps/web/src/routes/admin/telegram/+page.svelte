<script lang="ts">
import KeyConnect from '$lib/KeyConnect.svelte';

let { data } = $props();
const link = $derived(data.links.find(item => item.name === 'Телега'));
</script>

<header class="mb-6">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Telegram</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Бот</h1>
  {#if link}
    <p class="mt-3 flex items-center gap-2 text-sm text-zinc-300">
      <span class="size-2.5 rounded-full {link.ok ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]' : 'bg-rose-400'}"></span>
      {link.detail}
    </p>
  {/if}
</header>

<KeyConnect
  section="telegram"
  active={link?.ok === true}
  detail={link?.detail ?? ''}
  fields={[{ name: 'telegramToken', label: 'Токен бота', secret: true }]}
/>

<section class="mt-6 rounded-2xl border border-white/8 bg-[#151922] p-5 text-sm leading-6 text-zinc-300">
  <h2 class="text-base font-semibold text-white">Где взять токен</h2>
  <ol class="mt-3 list-decimal space-y-3 pl-5">
    <li>Открой <a class="text-indigo-300" href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> в Telegram.</li>
    <li>Бота ещё нет: отправь <span class="text-white">/newbot</span>. Имя любое. Username обязан кончаться на <span class="text-white">bot</span>, например <span class="text-white">hh_roman_bot</span>.</li>
    <li>Бот уже есть: <span class="text-white">/mybots</span>, выбери бота, потом API Token. Там же токен можно перевыпустить, если старый засветился.</li>
    <li>BotFather присылает одну строку: цифры, двоеточие, длинный хвост. Пример вида <span class="text-white">7123456789:AAHxx-пример-не-настоящий</span>. Это не chat id и не твой @username.</li>
    <li>Вставь строку в поле и кликни мимо. Сохранится само. Пустое поле старый токен не сотрёт. Справа сверху 15 секунд висит «Откатить».</li>
  </ol>
  <h2 class="mt-6 text-base font-semibold text-white">Как проверить, что бот живой</h2>
  <ol class="mt-3 list-decimal space-y-3 pl-5">
    <li>Напиши боту в личку с аккаунта <span class="text-white">@rtxRoman</span>. Первое сообщение привязывает чат. С другого аккаунта бот молчит.</li>
    <li>Команды текстом: <span class="text-white">старт</span> и <span class="text-white">стоп</span>. Кнопок в Telegram нет.</li>
    <li>Пока токен не пингуется, на обзоре карточка красная. Когда <span class="text-white">getMe</span> отвечает, рамка становится зелёной и тут видно username бота.</li>
  </ol>
</section>
