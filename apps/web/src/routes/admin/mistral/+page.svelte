<script lang="ts">
import SecretForm from '$lib/SecretForm.svelte';

let { data } = $props();
</script>

<header class="mb-6">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Mistral</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Ключ модели</h1>
  <p class="mt-2 text-sm text-zinc-400">Им серая зона вакансий решает: отклик, скип или человек.</p>
</header>

<SecretForm fields={[{ name: 'mistralKey', label: 'API key', secret: true, set: data.set.mistralKey }]} />

<section class="mt-6 rounded-2xl border border-white/8 bg-[#151922] p-5 text-sm leading-6 text-zinc-300">
  <h2 class="text-base font-semibold text-white">Где взять ключ</h2>
  <ol class="mt-3 list-decimal space-y-2 pl-5">
    <li>Открой <span class="text-white">https://console.mistral.ai/</span> и войди.</li>
    <li>Слева или в меню аккаунта пункт API keys.</li>
    <li>Create new key. Имя любое, например <span class="text-white">hh</span>.</li>
    <li>Ключ показывают один раз. Это длинная строка без пробелов, не путай с названием модели.</li>
    <li>Вставь в поле и кликни мимо. Если закрыл страницу раньше, создай ключ заново, старый уже не посмотреть.</li>
  </ol>
</section>
