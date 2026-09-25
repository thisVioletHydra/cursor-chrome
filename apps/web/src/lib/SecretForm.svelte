<script lang="ts">
import { enhance } from '$app/forms';

let { fields }: { fields: { name: string; label: string; secret: boolean; set: boolean }[] } = $props();
let undoLeft = $state(0);
let status = $state('');
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let tick: ReturnType<typeof setInterval> | undefined;

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

<form
  class="rounded-2xl border border-white/8 bg-[#151922] p-5"
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
  <div class="mb-5 flex items-end justify-between gap-4">
    <p class="text-sm text-zinc-500">{status || 'Пишется само. Пустое поле не затирает сохранённое.'}</p>
    {#if undoLeft > 0}
      <button class="rounded-full border border-white/10 px-4 py-2 text-sm" type="submit" formaction="?/undo">Откатить {undoLeft} с</button>
    {/if}
  </div>
  <div class="grid gap-5">
    {#each fields as field}
      <label class="flex flex-col gap-2 text-sm text-zinc-400">
        {field.label}
        <input
          class="h-11 rounded-xl border border-white/10 bg-black/30 px-3 text-zinc-100 outline-none focus:border-indigo-400"
          name={field.name}
          type={field.secret ? 'password' : 'text'}
          autocomplete="off"
          placeholder={field.set ? 'задан' : 'нет'}
          oninput={queueSave}
          onblur={queueSave}
        />
      </label>
    {/each}
  </div>
</form>
