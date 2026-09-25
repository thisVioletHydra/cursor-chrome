<script lang="ts">
import SecretForm from '$lib/SecretForm.svelte';

let { data } = $props();
</script>

<header class="mb-6">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Телега</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Бот</h1>
  <p class="mt-2 text-sm text-zinc-400">{data.polling ? 'Слушает «старт» и «стоп».' : 'Молчит, токена нет.'}</p>
</header>

<SecretForm fields={[{ name: 'telegramToken', label: 'Токен бота', secret: true, set: data.set.telegramToken }]} />

<section class="mt-6 rounded-2xl border border-white/8 bg-[#151922] p-5 text-sm leading-6 text-zinc-300">
  <h2 class="text-base font-semibold text-white">Где взять токен</h2>
  <ol class="mt-3 list-decimal space-y-2 pl-5">
    <li>Открой Telegram и найди <span class="text-white">@BotFather</span>.</li>
    <li>Бота ещё нет: отправь <span class="text-white">/newbot</span>, задай имя и username, он должен кончаться на <span class="text-white">bot</span>.</li>
    <li>Бот уже есть: <span class="text-white">/mybots</span> → твой бот → API Token.</li>
    <li>Скопируй строку вида <span class="text-white">7123456789:AAHxx-пример-не-настоящий</span>.</li>
    <li>Вставь в поле выше и кликни мимо поля. Пустое поле старый токен не сотрёт.</li>
  </ol>
</section>
