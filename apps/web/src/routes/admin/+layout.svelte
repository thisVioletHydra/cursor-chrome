<script lang="ts">
import { page } from '$app/stores';

let { data, children } = $props();

const items = [
  { href: '/admin', label: 'Главная' },
  { href: '/admin/telegram', label: 'Телега' },
  { href: '/admin/mistral', label: 'Mistral' },
  { href: '/admin/hh', label: 'HeadHunter' },
  { href: '/admin/billing', label: 'Расходы' },
];

const current = (href: string) => {
  const path = $page.url.pathname;
  if (href === '/admin')
    return path === '/admin';

  return path === href || path.startsWith(`${href}/`);
};
</script>

<div class="grid min-h-dvh grid-cols-[200px_1fr] bg-[#0b0d12] text-zinc-100">
  <aside class="flex flex-col justify-between border-r border-white/8 bg-[#10131a] px-4 py-6">
    <div>
      <div class="flex items-center gap-3">
        <span class="grid size-9 place-items-center rounded-xl bg-indigo-500 text-sm font-semibold text-white">H</span>
        <div>
          <p class="text-sm font-semibold">Админка</p>
          <p class="text-xs text-zinc-500">hh-auth</p>
        </div>
      </div>
      <nav class="mt-6 flex flex-col gap-1">
        {#each items as item}
          <a
            class="rounded-xl px-3 py-2 text-sm {current(item.href) ? 'bg-white/10 text-white' : 'text-zinc-400'}"
            href={item.href}
          >{item.label}</a>
        {/each}
      </nav>
    </div>
    <div>
      <p class="text-sm text-zinc-300">{data.login}</p>
      <form method="POST" action="/logout">
        <button class="mt-1 text-xs text-zinc-500" type="submit">Выйти</button>
      </form>
    </div>
  </aside>
  <main class="px-5 py-6 lg:px-10 lg:py-8">
    {@render children()}
  </main>
</div>
