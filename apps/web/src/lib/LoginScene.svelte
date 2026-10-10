<script lang="ts">
import { goto } from '$app/navigation';
import { onMount } from 'svelte';

let { authenticated = false, demo = false, expired = false, blocked = false, demoVersion = '' }: {
  authenticated?: boolean;
  demo?: boolean;
  expired?: boolean;
  blocked?: boolean;
  demoVersion?: string;
} = $props();

let entering = $state(false);
let arrived = $state(false);
let signingIn = $state(false);
let timer: ReturnType<typeof setTimeout> | undefined;

const navigation = ['Главная', 'Telegram', 'Модель', 'HeadHunter', 'Extension', 'Сопроводительное', 'ATS', 'Billing', 'Конфиг', 'Имитация'];

function finish(): void {
  if (demo) {
    arrived = true;
    return;
  }
  void goto('/admin', { replaceState: true });
}

function enter(): void {
  if (entering)
    return;
  entering = true;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  timer = setTimeout(finish, reducedMotion ? 0 : 1100);
}

function signIn(event: MouseEvent): void {
  if (demo) {
    event.preventDefault();
    enter();
    return;
  }
  signingIn = true;
}

function replay(): void {
  clearTimeout(timer);
  entering = false;
  arrived = false;
}

onMount(() => {
  if (authenticated)
    enter();
  return () => clearTimeout(timer);
});
</script>

<svelte:head>
  <title>{demo ? 'Демо входа' : 'Вход'} · Cursor Chrome</title>
  <meta name="theme-color" content="#0b0d12" />
  <link rel="preload" as="image" href="/start-land.jpg" />
</svelte:head>

<main class="login-scene" class:entering class:arrived>
  <div class="landscape" aria-hidden="true"></div>
  <div class="shade" aria-hidden="true"></div>
  <div class="brand">cursor<span>chrome</span><i aria-hidden="true"></i></div>

  {#if demo}
    <div class="demo-label">Локальная демка <span class="demo-version">{demoVersion}</span></div>
  {/if}

  <div class="entry" inert={entering} aria-hidden={entering}>
    <div class="halo" aria-hidden="true"></div>
    {#if expired}
      <p class="notice" role="status">Сессия завершилась. Войдём снова?</p>
    {/if}
    {#if blocked}
      <p class="notice" role="alert">Вход через GitHub пока не настроен.</p>
    {/if}
    <a class="github-entry" class:busy={signingIn || authenticated} href="/auth/github" onclick={signIn} aria-label="Войти через GitHub" aria-busy={signingIn || authenticated}>
      <span class="cat" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8" />
        </svg>
      </span>
      <span class="entry-label">{authenticated ? 'Добро пожаловать' : signingIn ? 'Переходим в GitHub…' : 'Войти через GitHub'}</span>
      <span class="entry-arrow" aria-hidden="true">↗</span>
    </a>
  </div>

  <section class="admin-preview" aria-hidden={!arrived} inert={!arrived}>
    <aside>
      <span class="preview-brand">cursor chrome</span>
      <nav aria-label="Предпросмотр админки">
        {#each navigation as label, index}
          <span class:active={index === 0}>{label}</span>
        {/each}
      </nav>
      <span class="preview-account">GitHub · вход выполнен</span>
    </aside>
    <div class="preview-content">
      <p class="eyebrow">Обзор</p>
      <h1>Сервисы</h1>
      {#if arrived}
        <p class="preview-note">Так выглядит переход после входа.</p>
        <button class="replay" type="button" onclick={replay}>Ещё раз ↺</button>
      {/if}
    </div>
  </section>
</main>

<style>
  :global(body) { margin: 0; background: #0b0d12; }
  .login-scene { position: relative; isolation: isolate; min-height: 100dvh; overflow: hidden; background: #0b0d12; color: #f2f1e9; font-family: system-ui, sans-serif; }
  .landscape, .shade { position: absolute; inset: 0; pointer-events: none; }
  .landscape { z-index: -3; background: url('/start-land.jpg') center 58% / cover; filter: saturate(.6); opacity: .48; transition: transform 1.2s ease, opacity 1s ease; }
  .shade { z-index: -2; background: linear-gradient(180deg, #0b0d12d9 0%, #0b0d1238 48%, #0b0d12d9 100%); }
  .brand { position: absolute; top: 32px; left: 40px; display: flex; align-items: center; gap: 5px; font-size: 15px; font-weight: 600; letter-spacing: -.5px; color: #dedfd9; transition: opacity .35s; }
  .brand span { font-weight: 400; color: #878b88; }
  .brand i { width: 5px; height: 5px; margin-left: 5px; border-radius: 50%; background: #c9d992; }
  .demo-label { position: absolute; top: 34px; right: 40px; z-index: 4; font-size: 12px; color: #959c99; }
  .demo-version { display: block; margin-top: 5px; font-family: monospace; font-size: 10px; text-align: right; color: #7d8490; }
  .entry { position: relative; display: grid; place-items: center; min-height: 100dvh; padding-bottom: 160px; box-sizing: border-box; transition: opacity .4s ease, transform .8s cubic-bezier(.22,1,.36,1); }
  .halo { position: absolute; width: min(620px, 100vw); aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle, #d7d77b16, #b3cc8010 28%, transparent 66%); pointer-events: none; }
  .github-entry { position: relative; display: flex; width: 208px; height: 208px; flex-direction: column; align-items: center; justify-content: center; gap: 25px; box-sizing: border-box; border: 1px solid #c4ce9138; border-radius: 28px; background: linear-gradient(145deg, #252a21e8, #151a18f2); color: #e9edca; text-decoration: none; box-shadow: 0 24px 80px #0005, inset 0 1px #eef5bd0d; transition: transform .25s, border-color .25s, box-shadow .25s, background .25s; }
  .github-entry:hover { transform: translateY(-5px); border-color: #d7e3988c; box-shadow: 0 24px 90px #b3cd7a14, inset 0 1px #eef5bd26; background: linear-gradient(145deg, #303629, #1a211a); }
  .github-entry:active { transform: translateY(-1px) scale(.97); }
  .github-entry:focus-visible { outline: 2px solid #d7e398; outline-offset: 7px; }
  .cat { display: block; width: 80px; height: 80px; transition: transform .3s; }
  .cat svg { display: block; width: 100%; height: 100%; }
  .github-entry:hover .cat { transform: rotate(-7deg); }
  .entry-label { font-size: 13px; font-weight: 500; letter-spacing: .1px; }
  .entry-arrow { position: absolute; top: 17px; right: 20px; font-size: 17px; color: #a1ae82; }
  .busy { pointer-events: none; }
  .notice { position: absolute; top: calc(50% - 240px); margin: 0; padding: 0 24px; font-size: 13px; text-align: center; color: #d8ddd0; }
  .admin-preview { position: absolute; inset: 0; display: grid; width: min(1200px, calc(100% - 80px)); margin-inline: auto; grid-template-columns: 200px 1fr; overflow: hidden; border: 1px solid #ffffff20; border-radius: 24px 24px 0 0; background: #0b0d12; box-shadow: 0 -18px 70px #0006; transform: translateY(calc(100dvh - 160px)); transition: transform 1.1s cubic-bezier(.22,1,.36,1), width 1.1s cubic-bezier(.22,1,.36,1), border-radius 1.1s; }
  .admin-preview aside { display: flex; flex-direction: column; gap: 28px; padding: 26px 16px; border-right: 1px solid #ffffff14; background: #10131a; }
  .preview-brand { padding: 0 9px; font-size: 13px; color: #949b97; }
  .admin-preview nav { display: grid; gap: 4px; }
  .admin-preview nav span { padding: 9px 12px; border-radius: 10px; font-size: 13px; color: #979ca6; }
  .admin-preview nav .active { background: #6366f14d; color: #fff; box-shadow: inset 0 0 0 1px #818cf866; }
  .preview-account { margin-top: auto; font-size: 12px; color: #8e949f; }
  .preview-content { padding: 36px 40px; }
  .eyebrow { margin: 0; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #737782; }
  h1 { margin: 6px 0 0; font-size: 32px; font-weight: 600; letter-spacing: -1px; }
  .preview-note { margin: 30px 0 14px; font-size: 14px; color: #a4aaad; }
  .replay { padding: 10px 15px; border: 1px solid #ffffff24; border-radius: 10px; background: #1c212b; font: inherit; font-size: 13px; color: #e4e4e7; cursor: pointer; }
  .replay:hover { background: #272c38; }
  .replay:focus-visible { outline: 2px solid #818cf8; outline-offset: 4px; }
  .entering .entry { opacity: 0; transform: translateY(-80px) scale(.9); pointer-events: none; }
  .entering .brand { opacity: 0; }
  .entering .landscape { transform: translateY(-8%) scale(1.05); opacity: 0; }
  .entering .admin-preview { width: 100%; transform: translateY(0); border-radius: 0; }
  @media (max-width: 600px) {
    .brand { top: 24px; left: 24px; }
    .demo-label { top: 27px; right: 24px; font-size: 10px; }
    .github-entry { width: 192px; height: 192px; }
    .entry { padding-bottom: 120px; }
    .notice { top: calc(50% - 210px); }
    .admin-preview { width: calc(100% - 28px); grid-template-columns: 135px 1fr; transform: translateY(calc(100dvh - 120px)); }
    .admin-preview aside { padding: 24px 9px; }
    .admin-preview nav span { font-size: 11px; padding: 8px; }
    .preview-content { padding: 28px 20px; }
    .preview-account { font-size: 10px; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition: none !important; }
  }
</style>
