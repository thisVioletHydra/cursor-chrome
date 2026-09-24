<script lang="ts">
import '../app.css';

let { children } = $props();
</script>

<main class="mx-auto max-w-xl px-4 py-10">
  {@render children()}
</main>
