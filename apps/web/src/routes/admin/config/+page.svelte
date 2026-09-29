<script lang="ts">
import { enhance } from '$app/forms';

let { data } = $props();
let fileInput = $state<HTMLInputElement>();
let fileName = $state('');
let importMessage = $state('');
let importOk = $state(false);
let importing = $state(false);

function openFile() {
  if (fileInput === undefined)
    return;

  fileInput.value = '';
  fileInput.click();
}

function chosenFile(event: Event) {
  const input = event.currentTarget;
  if (input instanceof HTMLInputElement === false)
    return;

  fileName = input.files?.[0]?.name ?? '';
  importMessage = '';
}

function onImport() {
  importing = true;
  importMessage = '';
  return async ({ result, update }) => {
    const body = result.type === 'success' ? result.data : null;
    importOk = body?.ok === true;
    importMessage = typeof body?.detail === 'string' ? body.detail : 'не вышло';
    try {
      if (importOk)
        await update();
    }
    finally {
      importing = false;
    }
  };
}
</script>

<header class="mb-5">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Аккаунт</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Конфиг</h1>
</header>

<section class="rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
  <h2 class="text-base font-semibold text-white">Импорт</h2>
  <p class="mt-2 text-sm text-zinc-400">Экспорт собирается в local-debug и импортируется сюда. Через 2 часа файл больше не принимается.</p>
  <form
    class="mt-4"
    method="POST"
    action="?/import"
    enctype="multipart/form-data"
    use:enhance={onImport}
  >
    <input
      bind:this={fileInput}
      class="sr-only"
      name="config"
      type="file"
      accept="application/json,.json"
      onchange={chosenFile}
    />
    <p class="text-sm {fileName === '' ? 'text-zinc-500' : 'text-zinc-100'}">{fileName === '' ? 'Файл не выбран' : fileName}</p>
    <div class="mt-3 flex flex-wrap gap-2">
      <button
        class="btn btn-ghost h-11 min-h-11 px-4"
        type="button"
        onclick={openFile}
      >{fileName === '' ? 'Выбрать файл' : 'Другой файл'}</button>
      {#if fileName !== ''}
        <button
          class="btn btn-ghost h-11 min-h-11 px-4 disabled:cursor-wait disabled:opacity-60"
          type="submit"
          disabled={importing}
        >{importing ? 'Импорт…' : 'Импортировать'}</button>
      {/if}
    </div>
    {#if importMessage !== ''}
      <p class="mt-3 text-sm break-words {importOk ? 'text-emerald-300' : 'text-rose-300'}" aria-live="polite">{importMessage}</p>
    {/if}
  </form>
</section>

<section class="mt-4 rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
  <h2 class="text-base font-semibold text-white">Что сохранено</h2>
  <ul class="mt-3 flex flex-col gap-2">
    {#each data.rows as row}
      <li class="flex min-w-0 items-center gap-2 text-sm">
        <span class="size-1.5 shrink-0 rounded-full {row.on ? 'bg-emerald-400' : 'bg-zinc-600'}" aria-hidden="true"></span>
        <span class="shrink-0 text-zinc-200">{row.label}</span>
        <span class="min-w-0 flex-1 truncate text-right text-zinc-400">{row.fact}</span>
      </li>
    {/each}
  </ul>
</section>

<section class="mt-4 rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
  <h2 class="text-base font-semibold text-white">Файл</h2>
  {#if data.bytes === null}
    <p class="mt-2 text-sm text-zinc-400">Файла нет.</p>
  {:else}
    <p class="mt-2 text-sm text-zinc-100">{data.bytes} байт</p>
    <p class="mt-1 text-sm text-zinc-400">Сохранено {data.savedAt}</p>
  {/if}
</section>

<section class="mt-4 rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
  <h2 class="text-base font-semibold text-white">Пример</h2>
  <p class="mt-2 text-sm text-zinc-400">Твой конфиг, ключи скрыты</p>
  <pre class="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-xs leading-5 text-zinc-300">{data.redacted}</pre>
</section>
