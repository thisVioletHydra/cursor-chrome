<script lang="ts">
let { text, copy = false, icon = false }: { text: string; copy?: boolean; icon?: boolean } = $props();
let done = $state(false);
let timer: ReturnType<typeof setTimeout> | undefined;

function put() {
  navigator.clipboard.writeText(text).then(() => {
    done = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      done = false;
    }, 1200);
  }).catch(() => {
    done = false;
  });
}
</script>

{#if copy}
  <button
    class="inline-flex max-w-full items-center gap-1.5 rounded-md text-left align-middle text-zinc-300 transition hover:bg-white/6 hover:text-zinc-100 {icon ? 'p-1.5' : 'px-1.5 py-0.5'}"
    type="button"
    aria-label="Скопировать"
    onclick={put}
  >
    {#if icon === false}
      <span class="min-w-0 font-mono text-[0.92em] break-all">{text}</span>
    {/if}
    {#if done}
      <svg class="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M5 12.5 9.5 17 19 7" />
      </svg>
    {:else}
      <svg class="size-3.5 shrink-0 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
      </svg>
    {/if}
  </button>
{:else}
  <span class="rounded-md bg-white/8 px-1.5 py-0.5 font-mono text-[0.92em] text-orange-300">{text}</span>
{/if}
