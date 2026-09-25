<script lang="ts">
let { data } = $props();

const lights = $derived([
  data.links.find(item => item.name === 'Телега'),
  data.links.find(item => item.name === 'Mistral'),
  data.links.find(item => item.name === 'HeadHunter'),
]);
</script>

<header class="mb-8">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Главная</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Сервисы</h1>
</header>

<div class="grid gap-4 md:grid-cols-3">
  {#each lights as light}
    {#if light}
      <article class="rounded-2xl border border-white/8 bg-[#151922] p-5">
        <div class="flex items-center gap-3">
          <span class="size-3 rounded-full {light.ok ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]' : 'bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.7)]'}"></span>
          <p class="text-sm text-zinc-400">{light.name}</p>
        </div>
        <p class="mt-4 text-lg font-medium">{light.detail}</p>
      </article>
    {/if}
  {/each}
</div>

<p class="mt-6 text-sm text-zinc-500">{data.polling ? 'Бот слушает команды.' : 'Бот молчит, пока нет токена телеги.'}</p>
