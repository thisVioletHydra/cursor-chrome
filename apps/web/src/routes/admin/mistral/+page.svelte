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
</header>

<KeyConnect
  section="mistral"
  active={link?.ok === true}
  detail={link?.detail ?? ''}
  wait={data.locks.mistral}
  fields={[{ name: 'mistralKey', label: 'API key', secret: true }]}
/>

<section class="mt-8 rounded-2xl border border-white/8 bg-[#151922] p-7 text-sm leading-7 text-zinc-300">
  <ol class="list-decimal space-y-4 pl-5">
    <li>Жми <Out href="https://console.mistral.ai/api-keys" text="API keys" /> и войди.</li>
    <li><Mark text="Create new key" />, скопируй строку. Показывают один раз.</li>
    <li>Вставь в поле сверху и жми <Mark text="Проверить" />.</li>
  </ol>
</section>
