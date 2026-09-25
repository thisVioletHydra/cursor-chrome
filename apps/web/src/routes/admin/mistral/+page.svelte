<script lang="ts">
import KeyConnect from '$lib/KeyConnect.svelte';
import Mark from '$lib/Mark.svelte';
import Out from '$lib/Out.svelte';

let { data } = $props();
const link = $derived(data.links.find(item => item.name === 'Mistral'));
let ask = $state(false);
</script>

<header class="mb-5">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Mistral</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Ключ модели</h1>
</header>

{#if link?.ok}
  <div class="flex items-center gap-3 rounded-2xl border border-white/8 bg-[#151922] px-4 py-3">
    <svg class="size-9 shrink-0 text-orange-300" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2 4 7v10l8 5 8-5V7zm0 2.3 5.5 3.4v6.6L12 17.7 6.5 14.3V7.7z" />
    </svg>
    <div class="min-w-0">
      <a class="block truncate text-sm text-indigo-300 underline-offset-4 hover:underline" href="https://console.mistral.ai/api-keys" target="_blank" rel="noreferrer">Mistral</a>
      <p class="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
        <span class="size-1.5 rounded-full bg-emerald-400"></span>
        активирован
      </p>
    </div>
    <button class="ml-auto cursor-pointer rounded-lg px-3 py-1.5 text-sm text-rose-400 transition hover:bg-rose-500 hover:text-white focus-visible:bg-rose-500 focus-visible:text-white focus-visible:outline-none" type="button" onclick={() => ask = true}>Отвязать</button>
  </div>
{/if}

<KeyConnect
  section="mistral"
  active={link?.ok === true}
  detail={link?.detail ?? ''}
  wait={data.locks.mistral}
  fields={[{ name: 'mistralKey', label: 'API key', secret: true }]}
  showActive={false}
  bind:ask
/>

<section class="mt-4 rounded-2xl border border-white/8 bg-[#151922] px-5 py-4 text-sm leading-6 text-zinc-300">
  <ol class="list-decimal space-y-2 pl-5">
    <li>Жми <Out href="https://console.mistral.ai/api-keys" text="API keys" /> и войди.</li>
    <li><Mark text="Create new key" />, скопируй строку. Показывают один раз.</li>
    <li>Вставь в поле сверху и жми <Mark text="Проверить" />.</li>
  </ol>
</section>
