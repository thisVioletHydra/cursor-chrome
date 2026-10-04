<script lang="ts">
import type { ChannelPost } from '$lib/channel-post';

import { enhance } from '$app/forms';
import { slide } from 'svelte/transition';

import KeyConnect from '$lib/KeyConnect.svelte';
import Mark from '$lib/Mark.svelte';
import Out from '$lib/Out.svelte';

let { data } = $props();
const link = $derived(data.links.find(item => item.name === 'Телега'));
const username = $derived(link?.detail.match(/@([A-Za-z0-9_]+)/)?.[1] ?? '');
let ask = $state(false);
let connecting = $state(false);
let connectError = $state('');
let draft = $state(data.feed === '' ? '' : `https://t.me/${data.feed}`);
let busy = $state(false);
let problem = $state('');
let opened = $state<{ name: string; posts: ChannelPost[] } | null>(null);

const when = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Bishkek',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function taken(value: unknown): { name: string; posts: ChannelPost[] } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null;

  const name = 'name' in value && typeof value.name === 'string' ? value.name : '';
  const posts = 'posts' in value && Array.isArray(value.posts) ? value.posts as ChannelPost[] : null;
  if (name === '' || posts === null)
    return null;

  return { name, posts };
}
</script>

<header class="mb-5">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Telegram</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Бот</h1>
</header>

{#if link?.ok && username}
  <div class="flex items-center gap-3 rounded-2xl border border-white/8 bg-[#151922] px-4 py-3">
    <svg class="size-9 shrink-0 text-sky-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.5 4.3 2.7 11.5c-1.3.5-1.3 1.2-.2 1.5l4.8 1.5 1.9 5.8c.2.7.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.2-.5-1.8-1.4-1.3M8.8 14.6l9.3-5.9c.5-.3.9-.1.5.2l-7.6 6.9-.3 3.2z" />
    </svg>
    <div class="min-w-0">
      <a class="block truncate text-sm text-indigo-300 underline-offset-4 hover:underline" href="https://t.me/{username}" target="_blank" rel="noreferrer">@{username}</a>
      <p class="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
        <span class="size-1.5 rounded-full bg-emerald-400"></span>
        активирован
      </p>
    </div>
    <button class="ml-auto cursor-pointer rounded-lg px-3 py-1.5 text-sm text-rose-400 transition hover:bg-rose-500 hover:text-white focus-visible:bg-rose-500 focus-visible:text-white focus-visible:outline-none" type="button" onclick={() => ask = true}>Отвязать</button>
  </div>
{/if}

{#if link?.ok && data.owner === false}
  <form
    class="mt-3"
    method="POST"
    action="?/connect"
    use:enhance={() => {
      connecting = true;
      connectError = '';
      return async ({ result, update }) => {
        connecting = false;
        if (result.type === 'failure') {
          connectError = typeof result.data?.detail === 'string' ? result.data.detail : 'Личного чата нет.';
          return;
        }

        if (result.type !== 'success') {
          connectError = 'Личного чата нет.';
          return;
        }

        await update();
      };
    }}
  >
    <button class="btn btn-primary btn-sm" type="submit" disabled={connecting}>
      {connecting ? 'Подключаю…' : 'Подключить чат'}
    </button>
    {#if connectError}
      <p class="mt-2 text-sm text-rose-300">{connectError}</p>
    {/if}
  </form>
{:else if link?.ok && data.owner}
  <p class="mt-3 text-sm text-emerald-300">Чат подключён</p>
{/if}

<KeyConnect
  section="telegram"
  active={link?.ok === true}
  detail={link?.detail ?? ''}
  wait={data.locks.telegram}
  fields={[{ name: 'telegramToken', label: 'Токен бота', secret: true }]}
  showActive={false}
  bind:ask
/>

<section class="mt-4 rounded-2xl border border-white/8 bg-[#151922] px-5 py-4 text-sm leading-6 text-zinc-300">
  <ol class="list-decimal space-y-2 pl-5">
    <li>Жми <Out href="https://t.me/BotFather" text="@BotFather" />.</li>
    <li>Бота нет: отправь <Mark text="/newbot" />. Бот есть: <Mark text="/mybots" />, потом <Mark text="API Token" />.</li>
    <li>Скопируй токен, вставь в поле сверху, жми <Mark text="Проверить" />.</li>
  </ol>
</section>

{#if data.preview === false}
<section class="mt-8 max-w-3xl">
  <h2 class="text-lg font-medium text-white">Лента</h2>
  <p class="mt-1 text-sm text-zinc-400">Вставь ссылку на открытый канал или группу.</p>
  <form
    class="mt-4 flex flex-col gap-3 sm:flex-row"
    method="POST"
    action="?/feed"
    use:enhance={() => {
      busy = true;
      problem = '';
      return async ({ result }) => {
        busy = false;
        if (result.type === 'failure') {
          problem = typeof result.data?.detail === 'string' ? result.data.detail : 'Канал не открылся.';
          return;
        }

        if (result.type === 'success')
          opened = taken(result.data);
      };
    }}
  >
    <input
      class="input input-bordered h-11 min-w-0 flex-1 border-white/10 bg-black/30 text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-400 focus:outline-none"
      name="link"
      placeholder="https://t.me/frontend_remote"
      autocomplete="off"
      spellcheck="false"
      bind:value={draft}
    />
    <button class="btn btn-primary h-11" type="submit" disabled={busy}>{busy ? 'Читаю…' : 'Ок'}</button>
  </form>
  {#if problem}
    <p class="mt-3 text-sm text-rose-300">{problem}</p>
  {/if}

  {#if busy === false && opened}
    <div class="mt-6" transition:slide={{ duration: 420 }}>
      {@render rows(opened.posts, opened.name)}
    </div>
  {:else if busy === false && data.feed}
    {#await data.channel.posts}
      <p class="mt-6 text-sm text-zinc-500">Читаю ленту…</p>
    {:then posts}
      <div class="mt-6" transition:slide={{ duration: 420 }}>
        {@render rows(posts, data.feed)}
      </div>
    {:catch}
      <p class="mt-6 text-sm text-rose-300">Канал не открылся.</p>
    {/await}
  {/if}
</section>
{/if}

{#snippet rows(posts: ChannelPost[], name: string)}
  <p class="text-sm text-zinc-500">
    <a class="text-indigo-300 underline-offset-4 hover:underline" href="https://t.me/{name}" target="_blank" rel="noreferrer">@{name}</a>
    · {posts.length} за 7 дней
  </p>
  {#if posts.length === 0}
    <p class="mt-4 text-sm text-zinc-500">За неделю пусто.</p>
  {:else}
    <ul class="mt-2 flex flex-col">
      {#each posts as post (post.id)}
        <li class="border-b border-white/8 py-4">
          <p class="text-xs text-zinc-500">{when.format(post.at)}{post.company ? ` · ${post.company}` : ''}</p>
          <h3 class="mt-1 text-base font-medium text-white">{post.title}</h3>
          {#if post.location || post.salary}
            <p class="mt-1 text-sm text-zinc-400">{[post.location, post.salary].filter(Boolean).join(' · ')}</p>
          {/if}
          {#if post.description}
            <p class="mt-2 line-clamp-3 text-sm text-zinc-300">{post.description}</p>
          {/if}
          <p class="mt-2 flex gap-4 text-sm">
            {#if post.apply}
              <a class="text-indigo-300 underline-offset-4 hover:underline" href={post.apply} target="_blank" rel="noreferrer">Вакансия</a>
            {/if}
            <a class="text-zinc-400 underline-offset-4 hover:underline" href={post.post} target="_blank" rel="noreferrer">Пост</a>
          </p>
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}
