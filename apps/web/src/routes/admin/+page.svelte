<script lang="ts">
let { data } = $props();

const cards = $derived([
  { href: '/admin/telegram', light: data.links.find(item => item.name === 'Телега') },
  { href: '/admin/model', light: data.links.find(item => item.name === 'Модель') },
  { href: '/admin/hh', light: data.links.find(item => item.name === 'HeadHunter') },
].flatMap(card => (card.light ? [{ href: card.href, light: card.light }] : [])));

const figures = $derived([
  { label: 'Сегодня', value: data.stats.today },
  { label: 'В очереди', value: data.stats.queued },
  { label: 'Ждут тебя', value: data.stats.waiting },
  { label: 'Приглашения', value: data.stats.invitations },
  { label: 'Отказы', value: data.stats.discards },
  { label: 'Ждём', value: data.stats.waitingReply },
]);

const statusText: Record<string, string> = {
  pending: 'в очереди',
  sent: 'откликнулся',
  needsHuman: 'ждёт тебя',
  dropped: 'снял',
};

const statusBadge: Record<string, string> = {
  pending: 'badge-primary',
  sent: 'badge-success',
  needsHuman: 'badge-warning',
  dropped: 'badge-ghost',
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

<section class="mt-8">
  <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
    <h2 class="text-lg font-semibold">Очередь</h2>
    <span class="badge badge-sm {data.stats.autopilot.auto ? 'badge-success' : 'badge-ghost'}">
      Автопилот {data.stats.autopilot.auto ? 'вкл' : 'выкл'}
    </span>
    <p class="text-xs text-zinc-500">{data.polling ? 'Бот слушает команды.' : 'Бот молчит, пока нет токена телеги.'}</p>
    {#if data.stats.autopilot.lastNote}
      <p class="text-xs text-zinc-500">{data.stats.autopilot.lastNote}</p>
    {/if}
  </div>
  <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
    {#each figures as figure}
      <div class="stat rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
        <div class="stat-title text-xs text-zinc-500">{figure.label}</div>
        <div class="stat-value text-3xl font-semibold text-white">{figure.value}</div>
      </div>
    {/each}
  </div>
  <div class="mt-3 overflow-x-auto rounded-2xl border border-white/8 bg-[#151922]">
    {#if data.stats.rows.length > 0}
      <table class="table">
        <thead>
          <tr class="text-xs text-zinc-500">
            <th>Вакансия</th>
            <th>Статус</th>
            <th>Когда</th>
          </tr>
        </thead>
        <tbody>
          {#each data.stats.rows as row (row.id)}
            <tr>
              <td class="max-w-xs truncate">
                <a class="text-zinc-200 underline-offset-4 hover:underline" href={row.url} target="_blank" rel="noreferrer">{row.company} · {row.title}</a>
              </td>
              <td><span class="badge badge-sm {statusBadge[row.status] ?? 'badge-ghost'}">{statusText[row.status] ?? row.status}</span></td>
              <td class="whitespace-nowrap text-xs text-zinc-500">{row.when}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="px-5 py-8 text-sm text-zinc-500">Очередь пустая. Напиши боту «старт».</p>
    {/if}
  </div>
</section>
