<script lang="ts">
let { data } = $props();

const cards = $derived([
  { href: '/admin/telegram', light: data.links.find(item => item.name === 'Телега') },
  { href: '/admin/model', light: data.links.find(item => item.name === 'Модель') },
  { href: '/admin/hh', light: data.links.find(item => item.name === 'HeadHunter') },
].flatMap(card => (card.light ? [{ href: card.href, light: card.light }] : [])));

const statusText: Record<string, string> = {
  pending: 'в очереди',
  sent: 'откликнулся',
  needsHuman: 'ждёт тебя',
};

const statusDot: Record<string, string> = {
  pending: 'bg-indigo-400',
  sent: 'bg-emerald-400',
  needsHuman: 'bg-amber-400',
};
</script>

<header class="mb-8">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Обзор</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Сервисы</h1>
  <p class="mt-2 text-sm text-zinc-500">Карточка или пункт слева ведут в один и тот же раздел. Зелёная рамка значит, что ключ активирован.</p>
</header>

<div class="grid gap-4 md:grid-cols-3">
  {#each cards as card}
    <a
      class="rounded-2xl border bg-[#151922] p-6 transition hover:-translate-y-0.5 hover:bg-[#1a1f29] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 {card.light.ok ? 'border-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.2)]' : 'border-white/8'}"
      href={card.href}
    >
      <div class="flex items-center gap-3">
        <span class="size-3 rounded-full {card.light.ok ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]' : 'bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.7)]'}"></span>
        <p class="text-sm text-zinc-400">{card.light.name}</p>
      </div>
      <p class="mt-4 text-lg font-medium">{card.light.detail}</p>
    </a>
  {/each}
</div>

<section class="mt-8 rounded-2xl border border-white/8 bg-[#151922] p-6">
  <div class="flex flex-wrap items-baseline gap-x-6 gap-y-2">
    <p class="text-sm text-zinc-400">Сегодня <span class="ml-1 text-2xl font-semibold text-white">{data.stats.today}</span></p>
    <p class="text-sm text-zinc-400">В очереди <span class="ml-1 text-2xl font-semibold text-white">{data.stats.queued}</span></p>
    <p class="text-sm text-zinc-400">Ждут тебя <span class="ml-1 text-2xl font-semibold text-white">{data.stats.waiting}</span></p>
    <p class="ml-auto text-xs text-zinc-500">{data.polling ? 'Бот слушает команды.' : 'Бот молчит, пока нет токена телеги.'}</p>
  </div>

  {#if data.stats.rows.length > 0}
    <ul class="mt-6 divide-y divide-white/6">
      {#each data.stats.rows as row (row.id)}
        <li class="flex items-center gap-3 py-3 text-sm">
          <span class="size-2 shrink-0 rounded-full {statusDot[row.status] ?? 'bg-zinc-500'}"></span>
          <a class="min-w-0 flex-1 truncate text-zinc-200 underline-offset-4 hover:underline" href={row.url} target="_blank" rel="noreferrer">{row.company} · {row.title}</a>
          <span class="shrink-0 text-xs text-zinc-500">{statusText[row.status] ?? row.status}</span>
          <span class="shrink-0 text-xs text-zinc-600">{row.when}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="mt-6 text-sm text-zinc-500">Очередь пустая. Напиши боту «старт».</p>
  {/if}
</section>
