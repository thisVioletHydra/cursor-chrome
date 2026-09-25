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
  {#if $page.data.billing.history.length > 0}
    <section class="mt-6 max-w-xl rounded-2xl border border-white/8 bg-[#151922]">
      {#each $page.data.billing.history as row}
        <div class="grid grid-cols-[1fr_auto] items-center gap-4 border-t border-white/8 px-6 py-4 first:border-t-0">
          <div>
            <a class="text-sm text-zinc-100 underline-offset-4 hover:underline" href={row.url} target="_blank" rel="noreferrer">{row.company}</a>
            <p class="mt-1 text-xs text-zinc-500">{row.when}</p>
          </div>
          <span class="text-sm text-zinc-400">{row.rub} ₽</span>
        </div>
      {/each}
    </section>
  {/if}
{:else}
  <article class="max-w-md rounded-2xl border border-white/8 bg-[#151922] p-6">
    <p class="text-sm text-zinc-400">Баланс</p>
    <p class="mt-3 text-5xl font-semibold tracking-tight">{$page.data.billing.balance} ₽</p>
    <p class="mt-4 text-sm text-zinc-400">1 вакансия = {$page.data.billing.vacancyRub} ₽. Сколько на счёте, столько откликов.</p>
  </article>
{/if}
