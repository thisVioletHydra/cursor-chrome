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

<header class="mb-8 flex items-center justify-between">
  <div>
    <h1 class="text-2xl font-semibold">Админка</h1>
    <p class="text-base-content/70">{data.login}</p>
  </div>
  <form method="POST" action="/logout">
    <button class="btn btn-ghost" type="submit">Выйти</button>
  </form>
</header>

<form
  class="flex flex-col gap-6"
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
  <section class="card bg-base-200">
    <div class="card-body gap-4">
      <div class="flex items-center justify-between gap-3">
        <h2 class="card-title">Телега</h2>
        {#if telegram}
          <span class="badge {telegram.ok ? 'badge-success' : 'badge-error'}">{telegram.detail}</span>
        {/if}
      </div>
      <p class="text-sm text-base-content/70">{data.polling ? 'Бот слушает' : 'Бот молчит'}</p>
      <label class="flex flex-col gap-1 text-sm">
        Токен бота
        <input class="input input-bordered w-full" name="telegramToken" type="password" autocomplete="off" placeholder={data.set.telegramToken ? 'задан' : 'нет'} oninput={queueSave} onblur={queueSave} />
      </label>
    </div>
  </section>

  <section class="card bg-base-200">
    <div class="card-body gap-4">
      <div class="flex items-center justify-between gap-3">
        <h2 class="card-title">Mistral</h2>
        {#if mistral}
          <span class="badge {mistral.ok ? 'badge-success' : 'badge-error'}">{mistral.detail}</span>
        {/if}
      </div>
      <label class="flex flex-col gap-1 text-sm">
        Ключ
        <input class="input input-bordered w-full" name="mistralKey" type="password" autocomplete="off" placeholder={data.set.mistralKey ? 'задан' : 'нет'} oninput={queueSave} onblur={queueSave} />
      </label>
    </div>
  </section>

  <section class="card bg-base-200">
    <div class="card-body gap-4">
      <div class="flex items-center justify-between gap-3">
        <h2 class="card-title">HeadHunter</h2>
        {#if hh}
          <span class="badge {hh.ok ? 'badge-success' : 'badge-error'}">{hh.detail}</span>
        {/if}
      </div>
      <label class="flex flex-col gap-1 text-sm">
        Access token
        <input class="input input-bordered w-full" name="hhAccessToken" type="password" autocomplete="off" placeholder={data.set.hhAccessToken ? 'задан' : 'нет'} oninput={queueSave} onblur={queueSave} />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        Resume id
        <input class="input input-bordered w-full" name="hhResumeId" autocomplete="off" placeholder={data.set.hhResumeId ? 'задан' : 'нет'} oninput={queueSave} onblur={queueSave} />
      </label>
    </div>
  </section>

  <div class="flex items-center gap-3">
    <p class="text-sm text-base-content/70">{status || 'Пишется само. Пустое поле не затирает сохранённое.'}</p>
    {#if undoLeft > 0}
      <button class="btn btn-ghost" type="submit" formaction="?/undo">Откатить {undoLeft} с</button>
    {/if}
  </div>
</form>
