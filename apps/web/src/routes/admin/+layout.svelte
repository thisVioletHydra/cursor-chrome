<script lang="ts">
import { page } from '$app/stores';

let { data, children } = $props();

const items = [
  { href: '/admin/telegram', label: 'Telegram' },
  { href: '/admin/mistral', label: 'Mistral' },
  { href: '/admin/hh', label: 'HeadHunter' },
  { href: '/admin/billing', label: 'Billing' },
];

const current = (href: string) => {
  const path = $page.url.pathname;

  return path === href || path.startsWith(`${href}/`);
};
</script>

<div class="grid h-dvh grid-cols-[200px_1fr] overflow-hidden bg-[#0b0d12] text-zinc-100">
  <aside class="flex h-full flex-col justify-between overflow-hidden border-r border-white/8 bg-[#10131a] px-4 py-6">
    <div>
      <a class="flex items-center gap-3" href="/admin">
        <span class="grid size-9 place-items-center rounded-xl bg-indigo-500 text-sm font-semibold text-white">H</span>
        <div>
          <p class="text-sm font-semibold">Обзор</p>
          <p class="text-xs text-zinc-500">hh-auth</p>
        </div>
      </a>
      <nav class="mt-6 flex flex-col gap-1">
        {#each items as item}
          <a
            class="rounded-xl px-3 py-2 text-sm transition hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 {current(item.href) ? 'bg-white/10 text-white' : 'text-zinc-400'}"
            href={item.href}
          >{item.label}</a>
        {/each}
      </nav>
    </div>
    <div>
      <p class="flex items-center gap-2 text-sm text-zinc-300">
        <span class="truncate">{data.login}</span>
        {#if data.billing.infinite}
          <span class="text-lg leading-none text-indigo-300" title="без лимита">∞</span>
        {:else}
          <span class="text-xs text-zinc-500">{data.billing.balance} ₽</span>
        {/if}
      </p>
      <form class="mt-3" method="POST" action="/logout">
        <button class="grid size-9 place-items-center rounded-lg text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400" type="submit" title="Выйти" aria-label="Выйти">
          <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M10 7V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-2" />
            <path d="M4 12h10" />
            <path d="m11 9 3 3-3 3" />
          </svg>
        </button>
      </form>
    </div>
  </aside>
  <main class="min-h-0 overflow-y-auto px-5 py-6 lg:px-10 lg:py-8">
    {@render children()}
  </main>
</div>
