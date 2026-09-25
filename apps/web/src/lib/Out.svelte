<script lang="ts">
let { href, text }: { href: string; text: string } = $props();
</script>

<a
  class="inline-flex items-center gap-1 text-indigo-300 underline-offset-4 transition hover:text-orange-200 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
  {href}
  target="_blank"
  rel="noreferrer"
>
  {text}
  <svg class="size-3.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M14 5h5v5" />
    <path d="M19 5 10 14" />
    <path d="M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5" />
  </svg>
</a>
