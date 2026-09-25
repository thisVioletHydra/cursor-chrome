<script lang="ts">
import SecretForm from '$lib/SecretForm.svelte';

let { data } = $props();
const link = $derived(data.links.find(item => item.name === 'Mistral'));
</script>

<header class="mb-6">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Mistral</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Ключ модели</h1>
  <p class="mt-2 text-sm text-zinc-400">Ключ читает серую зону вакансии и возвращает одно: отклик, скип или человек. Сам отклик он не шлёт.</p>
  {#if link}
    <p class="mt-3 flex items-center gap-2 text-sm text-zinc-300">
      <span class="size-2.5 rounded-full {link.ok ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]' : 'bg-rose-400'}"></span>
      {link.detail}
    </p>
  {/if}
</header>

<SecretForm fields={[{ name: 'mistralKey', label: 'API key', secret: true, set: data.set.mistralKey }]} />

<section class="mt-6 rounded-2xl border border-white/8 bg-[#151922] p-5 text-sm leading-6 text-zinc-300">
  <h2 class="text-base font-semibold text-white">Где взять ключ</h2>
  <ol class="mt-3 list-decimal space-y-3 pl-5">
    <li>Открой <a class="text-indigo-300" href="https://console.mistral.ai/" target="_blank" rel="noreferrer">console.mistral.ai</a> и войди. Аккаунта нет, регистрация там же.</li>
    <li>Дальше <a class="text-indigo-300" href="https://console.mistral.ai/api-keys" target="_blank" rel="noreferrer">API keys</a>. Если пункт спрятан, он в меню аккаунта слева.</li>
    <li>Create new key. Имя любое, например <span class="text-white">hh</span>. Название модели сюда не пиши, это не ключ.</li>
    <li>Строку показывают один раз. Закрыл страницу раньше, чем скопировал, создай новый ключ. Старый уже не открыть.</li>
    <li>Вставь в поле и кликни мимо. Пустое поле сохранённый ключ не сотрёт.</li>
    <li>Зелёная карточка на обзоре загорается, когда <span class="text-white">api.mistral.ai</span> принимает ключ. Ошибка 401 значит ключ кривой или отозван.</li>
  </ol>
</section>
