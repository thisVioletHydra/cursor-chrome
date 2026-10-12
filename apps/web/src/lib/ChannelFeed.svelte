<script lang="ts">
import type { ChannelPost } from './channel-post';

import { createVirtualizer } from '@tanstack/svelte-virtual';
import { get } from 'svelte/store';

let { posts }: { posts: ChannelPost[] } = $props();
let viewport = $state<HTMLDivElement | null>(null);

const when = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Bishkek',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const virtualizer = createVirtualizer<HTMLDivElement, HTMLLIElement>({
  count: 0,
  getScrollElement: () => viewport,
  estimateSize: () => 480,
  overscan: 3,
});

$effect(() => {
  const element = viewport;
  const items = posts;
  get(virtualizer).setOptions({
    count: items.length,
    getScrollElement: () => element,
    getItemKey: index => items[index].id,
  });
});

function measure(node: HTMLLIElement): { destroy: () => void } {
  get(virtualizer).measureElement(node);
  return { destroy: () => get(virtualizer).measureElement(null) };
}
</script>

<p class="mt-6 text-sm text-zinc-500">{posts.length} за 7 дней</p>
{#if posts.length === 0}
  <p class="mt-4 text-sm text-zinc-500">За неделю пусто.</p>
{:else}
  <div
    class="feed-viewport mt-3 rounded-2xl"
    bind:this={viewport}
    tabindex="0"
    role="region"
    aria-label="Вакансии из Telegram, {posts.length} за неделю"
  >
    <ul class="relative m-0 list-none p-0" style:height="{$virtualizer.getTotalSize()}px">
      {#each $virtualizer.getVirtualItems() as row (row.key)}
        {@const post = posts[row.index]}
        <li
          class="absolute top-0 left-0 w-full pb-3"
          style:transform="translateY({row.start}px)"
          data-index={row.index}
          aria-posinset={row.index + 1}
          aria-setsize={posts.length}
          use:measure
        >
          <article class="rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
            <p class="text-xs text-zinc-500">{[when.format(post.at), post.company, post.location, post.salary].filter(Boolean).join(' · ')}</p>
            <h3 class="mt-1 text-lg font-medium text-white">{post.title}</h3>
            {#if post.body}
              <p class="mt-3 whitespace-pre-line text-sm leading-6 text-zinc-200">{post.body}</p>
            {/if}
            {#if post.apply}
              <a class="mt-3 inline-block text-sm text-indigo-300 underline-offset-4 hover:underline" href={post.apply} target="_blank" rel="noreferrer">Вакансия</a>
            {/if}
          </article>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .feed-viewport {
    height: min(70dvh, 44rem);
    min-height: 18rem;
    overflow-y: auto;
    overflow-x: hidden;
    overflow-wrap: anywhere;
    scrollbar-gutter: stable;
    overflow-anchor: none;
  }

  .feed-viewport:focus-visible {
    outline: 2px solid #818cf8;
    outline-offset: 4px;
  }
</style>
