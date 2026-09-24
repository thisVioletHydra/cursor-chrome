<script lang="ts">
let { data } = $props();
</script>

<div class="card bg-base-200">
  <div class="card-body">
    <h1 class="card-title text-2xl">Админка</h1>
    <p>Вход только через GitHub. Чужой аккаунт остаётся снаружи.</p>
    {#if data.ready}
      <a class="btn btn-primary w-fit" href="/auth/github">Войти через GitHub</a>
    {:else}
      <div class="alert alert-warning">
        Нет GITHUB_CLIENT_ID и GITHUB_CLIENT_SECRET. Callback: {data.callback}
      </div>
    {/if}
  </div>
</div>
