<script lang="ts">
import { page } from '$app/stores';
import NavIcon from './NavIcon.svelte';

let { data, children } = $props();
let accountOpen = $state(false);

const items: { href: string; label: string; exact: boolean; icon?: string }[] = [
  { href: '/admin', label: 'Главная', exact: true, icon: 'home' },
  { href: '/admin/telegram', label: 'Telegram', exact: false, icon: 'plane' },
  { href: '/admin/model', label: 'Модель', exact: false, icon: 'spark' },
  { href: '/admin/hh', label: 'HeadHunter', exact: false, icon: 'briefcase' },
  { href: '/admin/extension', label: 'Extension', exact: false, icon: 'puzzle' },
  { href: '/admin/letter', label: 'Сопроводительное', exact: false, icon: 'letter' },
  { href: '/admin/ats', label: 'ATS', exact: false, icon: 'doc' },
  { href: '/admin/billing', label: 'Billing', exact: false, icon: 'card' },
  { href: '/admin/config', label: 'Конфиг', exact: false, icon: 'file' },
  { href: '/admin/imitation', label: 'Имитация', exact: false, icon: 'person' },
];

const iconByLabel: Record<string, string> = {
  'Главная': 'home',
  Telegram: 'plane',
  'Модель': 'spark',
  HeadHunter: 'briefcase',
  Extension: 'puzzle',
  'Сопроводительное': 'letter',
  ATS: 'doc',
  Billing: 'card',
  'Конфиг': 'file',
  'Имитация': 'person',
};

function iconName(item: { label: string; icon?: string }): string {
  return item.icon ?? iconByLabel[item.label] ?? 'mark';
}

const current = (href: string, exact: boolean) => {
  const path = $page.url.pathname;
  if (exact)
    return path === href;

  return path === href || path.startsWith(`${href}/`);
};
</script>

<div class="grid h-dvh grid-cols-[200px_1fr] overflow-hidden bg-[#0b0d12] text-zinc-100" style="view-transition-name: admin-app">
  <aside class="flex h-full flex-col overflow-hidden border-r border-white/8 bg-[#10131a] px-4 py-6">
    <div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <nav class="flex flex-col gap-1">
        {#each items as item}
          {@const on = current(item.href, item.exact)}
          <a
            class="flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 {on ? 'bg-indigo-500/30 text-white ring-1 ring-inset ring-indigo-400/60 hover:bg-indigo-500/40' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}"
            href={item.href}
            aria-current={on ? 'page' : undefined}
          >
            <NavIcon name={iconName(item)} class={on ? 'text-indigo-300' : ''} />
            <span class="min-w-0 flex-1 truncate">{item.label}</span>
          </a>
        {/each}
      </nav>
    </div>
    <div class="relative mt-3 shrink-0">
      {#if accountOpen}
        <button class="fixed inset-0 z-20 cursor-default" type="button" aria-label="Закрыть" onclick={() => accountOpen = false}></button>
        <div class="absolute bottom-full left-0 z-30 mb-2 w-full rounded-xl border border-white/10 bg-[#1c212b] p-1 shadow-lg">
          <p class="px-3 py-2 text-sm text-zinc-400">Баланс · {data.billing.infinite ? '∞' : `${data.billing.balance} ₽`}</p>
          {#if data.canPreview}
            <a class="flex w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400" href="/start">Демка входа</a>
            <form method="POST" action="/admin/preview">
              <button class="flex w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400" type="submit">{data.preview ? 'Свой аккаунт' : 'Гость · 200'}</button>
            </form>
          {/if}
          <form method="POST" action="/logout">
            <button class="flex w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400" type="submit">Выйти</button>
          </form>
        </div>
      {/if}
      <button
        class="relative z-30 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
        type="button"
        aria-expanded={accountOpen}
        aria-label="Аккаунт"
        onclick={() => accountOpen = !accountOpen}
      >
        <svg class="size-5 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8" />
        </svg>
        <span class="min-w-0 flex-1 truncate text-sm text-zinc-200">{data.login}</span>
        <svg class="size-4 shrink-0 text-zinc-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>
    </div>
  </aside>
  <main class="min-h-0 overflow-y-auto px-5 py-6 lg:px-10 lg:py-8">
    {@render children()}
  </main>
</div>
