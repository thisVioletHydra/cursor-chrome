<script lang="ts">
import { enhance } from '$app/forms';

let { data } = $props();
let undoLeft = $state(0);
let status = $state('');
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let tick: ReturnType<typeof setInterval> | undefined;

const link = (name: string) => data.links.find(item => item.name === name);
const telegram = link('Телега');
const mistral = link('Mistral');
const hh = link('HeadHunter');

function armUndo() {
  undoLeft = 15;
  clearInterval(tick);
  tick = setInterval(() => {
    undoLeft -= 1;
    if (undoLeft > 0)
      return;

    undoLeft = 0;
    clearInterval(tick);
  }, 1000);
}

function queueSave(event: Event) {
  const input = event.currentTarget;
  if ((input instanceof HTMLInputElement) === false)
    return;

  if (input.value.trim().length === 0)
    return;

  const formEl = input.form;
  if (formEl === null)
    return;

  clearTimeout(saveTimer);
  const wait = event.type === 'blur' ? 0 : 700;
  saveTimer = setTimeout(() => {
    status = 'сохраняю';
    formEl.requestSubmit();
  }, wait);
}
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
      <p class="mt-6 rounded-xl bg-white/5 px-3 py-2 text-sm text-zinc-300">Обзор</p>
    </div>
    <div>
      <p class="text-sm text-zinc-300">{data.login}</p>
      <form method="POST" action="/logout">
        <button class="mt-1 text-xs text-zinc-500" type="submit">Выйти</button>
      </form>
    </div>
  </aside>

  <main class="px-5 py-6 lg:px-10 lg:py-8">
    <header class="mb-8">
      <p class="text-xs tracking-wide text-zinc-500 uppercase">Связи</p>
      <h1 class="mt-1 text-3xl font-semibold tracking-tight">Обзор</h1>
    </header>

    <div class="grid gap-4 md:grid-cols-3">
      <article class="rounded-2xl border border-white/8 bg-[#151922] p-5">
        <p class="text-sm text-zinc-400">Телега</p>
        <p class="mt-3 text-lg font-medium">{telegram?.detail ?? 'нет данных'}</p>
        <p class="mt-2 text-xs text-zinc-500">{data.polling ? 'Бот слушает' : 'Бот молчит'}</p>
      </article>
      <article class="rounded-2xl border border-white/8 bg-[#151922] p-5">
        <p class="text-sm text-zinc-400">Mistral</p>
        <p class="mt-3 text-lg font-medium">{mistral?.detail ?? 'нет данных'}</p>
      </article>
      <article class="rounded-2xl border border-white/8 bg-[#151922] p-5">
        <p class="text-sm text-zinc-400">HeadHunter</p>
        <p class="mt-3 text-lg font-medium">{hh?.detail ?? 'нет данных'}</p>
      </article>
    </div>

    <form
      class="mt-8 rounded-2xl border border-white/8 bg-[#151922] p-5 lg:p-6"
      method="POST"
      action="?/save"
      use:enhance={() => {
        return async ({ result, update }) => {
          await update({ reset: true });
          const saved = result.type === 'success' && result.data?.saved === true;
          const undone = result.type === 'success' && result.data?.undone === true;
          if (undone) {
            undoLeft = 0;
            clearInterval(tick);
            status = 'откатил';
            return;
          }

          status = saved ? 'сохранено' : '';
          if (saved)
            armUndo();
        };
      }}
    >
      <button class="hidden" type="submit" tabindex="-1" aria-hidden="true"></button>
      <div class="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 class="text-lg font-semibold">Ключи</h2>
          <p class="mt-1 text-sm text-zinc-500">{status || 'Пишется само. Пустое поле не затирает сохранённое.'}</p>
        </div>
        {#if undoLeft > 0}
          <button class="rounded-full border border-white/10 px-4 py-2 text-sm" type="submit" formaction="?/undo">Откатить {undoLeft} с</button>
        {/if}
      </div>

      <div class="grid gap-6 md:grid-cols-2">
        <label class="flex flex-col gap-2 text-sm text-zinc-400">
          Токен бота
          <input class="h-11 rounded-xl border border-white/10 bg-black/30 px-3 text-zinc-100 outline-none focus:border-indigo-400" name="telegramToken" type="password" autocomplete="off" placeholder={data.set.telegramToken ? 'задан' : 'нет'} oninput={queueSave} onblur={queueSave} />
        </label>
        <label class="flex flex-col gap-2 text-sm text-zinc-400">
          Ключ Mistral
          <input class="h-11 rounded-xl border border-white/10 bg-black/30 px-3 text-zinc-100 outline-none focus:border-indigo-400" name="mistralKey" type="password" autocomplete="off" placeholder={data.set.mistralKey ? 'задан' : 'нет'} oninput={queueSave} onblur={queueSave} />
        </label>
        <label class="flex flex-col gap-2 text-sm text-zinc-400">
          HH access token
          <input class="h-11 rounded-xl border border-white/10 bg-black/30 px-3 text-zinc-100 outline-none focus:border-indigo-400" name="hhAccessToken" type="password" autocomplete="off" placeholder={data.set.hhAccessToken ? 'задан' : 'нет'} oninput={queueSave} onblur={queueSave} />
        </label>
        <label class="flex flex-col gap-2 text-sm text-zinc-400">
          HH resume id
          <input class="h-11 rounded-xl border border-white/10 bg-black/30 px-3 text-zinc-100 outline-none focus:border-indigo-400" name="hhResumeId" autocomplete="off" placeholder={data.set.hhResumeId ? 'задан' : 'нет'} oninput={queueSave} onblur={queueSave} />
        </label>
      </div>
    </form>
  </main>
</div>
