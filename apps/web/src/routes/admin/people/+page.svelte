<script lang="ts">
let { data } = $props();
</script>

<svelte:head>
  <title>Люди</title>
</svelte:head>

<p class="text-xs tracking-wide text-zinc-500 uppercase">Доступ</p>
<h1 class="mt-1 text-3xl font-semibold tracking-tight">Люди</h1>
<p class="mt-3 max-w-xl text-sm text-zinc-400">Неделя отмечается руками. Открытие обнуляет нагрузку. Свой поиск сюда не входит.</p>

{#if data.people.length === 0}
  <p class="mt-8 text-sm text-zinc-500">Пока никого.</p>
{:else}
  <ul class="mt-8 flex max-w-xl flex-col gap-3">
    {#each data.people as person (person.login)}
      <li class="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
        <div>
          <p class="text-sm text-white">{person.login}</p>
          <p class="text-xs text-zinc-500">{person.open ? 'неделя открыта' : 'неделя закрыта'} · {person.load}%</p>
        </div>
        <form method="POST" action="?/open">
          <input name="login" type="hidden" value={person.login} />
          <button class="rounded-full bg-white px-3 py-1.5 text-sm text-zinc-950" type="submit">Открыть неделю</button>
        </form>
      </li>
    {/each}
  </ul>
{/if}
