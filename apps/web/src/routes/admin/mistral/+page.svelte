<script lang="ts">
import KeyConnect from '$lib/KeyConnect.svelte';
import Mark from '$lib/Mark.svelte';
import Out from '$lib/Out.svelte';

let { data } = $props();
const link = $derived(data.links.find(item => item.name === 'Mistral'));
</script>

<header class="mb-8">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Mistral</p>
  <h1 class="mt-2 text-3xl font-semibold tracking-tight">Ключ модели</h1>
  <p class="mt-3 max-w-xl text-sm leading-6 text-zinc-400">Ключ читает серую зону вакансии и возвращает одно: отклик, скип или человек.</p>
</header>

<KeyConnect
  section="mistral"
  active={link?.ok === true}
  detail={link?.detail ?? ''}
  wait={data.locks.mistral}
  fields={[{ name: 'mistralKey', label: 'API key', secret: true }]}
/>

<section class="mt-8 rounded-2xl border border-white/8 bg-[#151922] p-7 text-sm leading-7 text-zinc-300">
  <h2 class="text-base font-semibold text-white">Где взять ключ</h2>
  <ol class="mt-4 list-decimal space-y-4 pl-5">
    <li>Открой <Out href="https://console.mistral.ai/" text="console.mistral.ai" /> и войди.</li>
    <li>Дальше <Out href="https://console.mistral.ai/api-keys" text="API keys" />.</li>
    <li><Mark text="Create new key" />. Имя любое, например <Mark text="hh" />.</li>
    <li>Строку показывают один раз. Закрыл раньше, чем скопировал, создай новый ключ.</li>
    <li>Вставь в поле и нажми <Mark text="Проверить" />. <Mark text="401" /> значит ключ кривой или отозван.</li>
  </ol>
</section>
