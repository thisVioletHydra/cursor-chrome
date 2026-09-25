<script lang="ts">
let { data } = $props();
</script>

<div class="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 py-8">
<div class="mt-auto flex flex-col gap-3">
  {#if data.blocked}
    <p class="text-center text-sm">Сюда не уводит: GitHub ещё не подключён.</p>
  {/if}
  <a class="btn btn-primary btn-lg w-full" href="/auth/github">Войти через GitHub</a>
</div>
</div>
