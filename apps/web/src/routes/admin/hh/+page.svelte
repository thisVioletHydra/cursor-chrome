<script lang="ts">
import { enhance } from '$app/forms';
import KeyConnect from '$lib/KeyConnect.svelte';
import Mark from '$lib/Mark.svelte';
import Out from '$lib/Out.svelte';

let { data } = $props();
const link = $derived(data.links.find(item => item.name === 'HeadHunter'));
let step = $state(0);
let openUnlink = $state(false);
let phrase = $state('');
let resumeOpen = $state(false);
let resumeDraft = $state('');
let resumePhase = $state<'idle' | 'checking' | 'error'>('idle');
let resumeMessage = $state('');
let tokenNote = $state('');
let booted = false;

$effect(() => {
  if (booted || typeof sessionStorage === 'undefined')
    return;

  booted = true;
  const saved = sessionStorage.getItem('hh-step');
  if (saved === '0' || saved === '1')
    step = Number(saved);
  else
    step = data.resumeId ? 1 : 0;
});

$effect(() => {
  if (booted === false || typeof sessionStorage === 'undefined')
    return;

  sessionStorage.setItem('hh-step', String(step));
});

function openResume() {
  resumeOpen = true;
  resumeDraft = `https://hh.ru/resume/${data.resumeId}`;
  resumeMessage = '';
  resumePhase = 'idle';
}
</script>

<header class="mb-5">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">HeadHunter</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Отклики</h1>
</header>

<div class="mb-4 grid gap-3">
  {#if data.resumeId}
    <div class="flex items-center gap-3 rounded-2xl border border-white/8 bg-[#151922] px-4 py-3">
      <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-[#d6001c] text-sm font-semibold text-white">hh</span>
      <div class="min-w-0">
        <a class="block truncate text-sm text-indigo-300 underline-offset-4 hover:underline" href="https://hh.ru/resume/{data.resumeId}" target="_blank" rel="noreferrer">{data.resumeId}</a>
        <p class="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
          <span class="size-1.5 rounded-full bg-emerald-400"></span>
          ссылка есть
        </p>
      </div>
      <button class="ml-auto cursor-pointer rounded-lg px-3 py-1.5 text-sm text-rose-400 transition hover:bg-rose-500 hover:text-white focus-visible:bg-rose-500 focus-visible:text-white focus-visible:outline-none" type="button" onclick={() => { phrase = ''; openUnlink = true; }}>Отвязать</button>
    </div>
  {/if}
  {#if link?.ok}
    <div class="flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-[#151922] px-4 py-3">
      <span class="size-1.5 shrink-0 rounded-full bg-emerald-400"></span>
      <p class="text-sm text-zinc-200">{link.detail || 'Токен активирован'}</p>
    </div>
  {:else if tokenNote}
    <div class="flex items-center gap-3 rounded-2xl border border-rose-400/30 bg-[#151922] px-4 py-3">
      <span class="size-1.5 shrink-0 rounded-full bg-rose-400"></span>
      <p class="font-mono text-sm text-rose-200">{tokenNote}</p>
    </div>
  {/if}
</div>

<section class="rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
  <div class="mb-4 flex items-center gap-2">
    <button
      class="btn btn-ghost btn-sm"
      type="button"
      aria-label="Назад"
      disabled={step === 0}
      onclick={() => step = 0}
    >←</button>
    <span class="text-xs text-zinc-500">{step + 1} / 2</span>
    <button
      class="btn btn-ghost btn-sm"
      type="button"
      aria-label="Дальше"
      disabled={step === 1 || data.resumeId.length === 0}
      onclick={() => step = 1}
    >→</button>
  </div>

  {#if step === 0}
    <h2 class="text-base font-semibold text-white">Введите ссылку на резюме</h2>
    {#if data.resumeId && resumeOpen === false}
      <div class="mt-4 flex items-end gap-3">
        <div class="flex h-11 min-w-0 flex-1 items-center rounded-lg border border-white/10 bg-black/30 px-3 text-sm">
          <span class="truncate"><span class="text-zinc-500">https://hh.ru/resume/</span><span class="text-zinc-100">{data.resumeId}</span></span>
        </div>
        <button class="btn btn-ghost h-11 min-h-11 px-3" type="button" aria-label="Изменить ссылку" onclick={openResume}>
          <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </button>
      </div>
    {:else}
      <p class="mt-2 text-sm text-zinc-400">Открой <Out href="https://hh.ru/applicant/resumes" text="резюме" />, скопируй адресную строку и вставь сюда.</p>
      {#if resumeMessage}
        <p class="mt-3 font-mono text-xs text-rose-300">{resumeMessage}</p>
      {/if}
      <form
        class="mt-4 flex items-end gap-3"
        method="POST"
        action="?/resume"
        use:enhance={() => {
          resumePhase = 'checking';
          resumeMessage = '';
          return async ({ result, update }) => {
            const body = result.type === 'success' ? result.data : null;
            if (body?.ok === true) {
              step = 1;
              resumeOpen = false;
              await update();
              return;
            }

            resumePhase = 'error';
            resumeMessage = typeof body?.detail === 'string' ? body.detail : 'не вышло';
          };
        }}
      >
        <input
          class="input input-bordered h-11 min-w-0 flex-1 border-white/10 bg-black/30 text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-400 focus:outline-none"
          name="hhResumeId"
          autocomplete="off"
          placeholder="https://hh.ru/resume/..."
          readonly={resumePhase === 'checking'}
          bind:value={resumeDraft}
        />
        <button class="btn btn-primary h-11 min-h-11 shrink-0 px-4" type="submit" disabled={resumePhase === 'checking' || resumeDraft.trim().length === 0}>
          {resumePhase === 'checking' ? 'Проверяю' : 'Проверить'}
        </button>
      </form>
    {/if}
  {:else}
    <h2 class="text-base font-semibold text-white">Access token</h2>
    <ol class="mt-4 list-decimal space-y-4 pl-5 text-sm leading-6 text-zinc-300">
      <li>Жми <Out href="https://dev.hh.ru/admin" text="dev.hh.ru/admin" />. Добавь приложение. Redirect: <Mark text="http://localhost" />.</li>
      <li>В ссылку подставь Client ID и жми её. Разреши доступ. <Mark text="https://hh.ru/oauth/authorize?response_type=code&client_id=ТВОЙ_CLIENT_ID" /></li>
      <li>Со страницы <Mark text="http://localhost/?code=..." /> скопируй <Mark text="code" />.</li>
      <li>Вставь в терминал, подставив свои значения. В ответе бери <Mark text="access_token" />.</li>
      <li>Вставь токен и жми <Mark text="Проверить" />.</li>
    </ol>
    <pre class="mt-4 overflow-x-auto rounded-xl bg-black/40 p-4 text-xs leading-6 text-orange-200/90">curl -X POST https://hh.ru/oauth/token \
  -d grant_type=authorization_code \
  -d client_id=CLIENT_ID \
  -d client_secret=CLIENT_SECRET \
  -d redirect_uri=http://localhost \
  -d code=CODE</pre>
    <div class="mt-4">
      <KeyConnect
        section="hh"
        active={link?.ok === true}
        detail={link?.detail ?? ''}
        wait={data.locks.hh}
        fields={[{ name: 'hhAccessToken', label: 'Access token', secret: true }]}
        showActive={false}
        quiet
        bare
        bind:note={tokenNote}
      />
    </div>
  {/if}
</section>

{#if openUnlink}
  <dialog class="modal modal-open">
    <div class="modal-box border border-white/10 bg-[#151922]">
      <form method="POST" action="?/unlink">
        <p class="text-sm leading-6 text-zinc-300">Впиши unlink, чтобы отвязать.</p>
        <input class="input input-bordered mt-4 w-full border-white/10 bg-black/30 focus:border-indigo-400 focus:outline-none" name="phrase" autocomplete="off" bind:value={phrase} />
        <input name="section" type="hidden" value="hh" />
        <div class="mt-5 flex gap-3">
          <button class="btn btn-error" type="submit" disabled={phrase !== 'unlink'}>Отвязать</button>
          <button class="btn btn-ghost" type="button" onclick={() => openUnlink = false}>Закрыть</button>
        </div>
      </form>
    </div>
    <button class="modal-backdrop" type="button" aria-label="Закрыть" onclick={() => openUnlink = false}></button>
  </dialog>
{/if}
