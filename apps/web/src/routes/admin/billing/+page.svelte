<script lang="ts">
import { page } from '$app/stores';
</script>

<header class="mb-8">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Billing</p>
  <h1 class="mt-2 text-3xl font-semibold tracking-tight">Расходы</h1>
</header>

{#if $page.data.billing.infinite}
  <article class="max-w-md rounded-2xl border border-indigo-400/40 bg-[#151922] p-6">
    <p class="text-sm text-zinc-400">Создатель</p>
    <p class="mt-3 text-6xl leading-none text-indigo-300">∞</p>
    <p class="mt-4 text-sm text-zinc-400">Лимита нет. Вакансии не списываются.</p>
  </article>
{:else}
  <article class="max-w-md rounded-2xl border border-white/8 bg-[#151922] p-6">
    <p class="text-sm text-zinc-400">Баланс</p>
    <p class="mt-3 text-5xl font-semibold tracking-tight">{$page.data.billing.balance} ₽</p>
    <p class="mt-4 text-sm text-zinc-400">1 вакансия = {$page.data.billing.vacancyRub} ₽. Сколько на счёте, столько откликов.</p>
  </article>
{/if}
