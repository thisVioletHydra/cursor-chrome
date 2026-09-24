<script lang="ts">
import '../app.css';

let { children } = $props();
</script>

<main class="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-8">
  {@render children()}
</main>
