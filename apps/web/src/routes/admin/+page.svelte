<script lang="ts">
let { data, form } = $props();
</script>

<header class="mb-6 flex items-center justify-between">
  <div>
    <h1 class="text-2xl font-semibold">Админка</h1>
    <p class="text-base-content/70">{data.login}</p>
  </div>
  <form method="POST" action="/logout">
    <button class="btn btn-ghost" type="submit">Выйти</button>
  </form>
</header>

<div class="grid gap-3">
  {#each data.links as link}
    <div class="card bg-base-200">
      <div class="card-body flex-row items-center justify-between py-4">
        <strong>{link.name}</strong>
        <span class="badge {link.ok ? 'badge-success' : 'badge-error'}">{link.detail}</span>
      </div>
    </div>
  {/each}
</div>

<form class="card bg-base-200 mt-6" method="POST" action="?/save">
  <div class="card-body gap-3">
    <h2 class="card-title">Ключи</h2>
    <p class="text-sm text-base-content/70">Пустое поле не затирает уже сохранённое. Значения обратно не показываются.</p>
    <label class="form-control">Токен телеги <input class="input input-bordered w-full" name="telegramToken" type="password" autocomplete="off" placeholder={data.set.telegramToken ? 'задан' : 'нет'} /></label>
    <label class="form-control">Ключ Mistral <input class="input input-bordered w-full" name="mistralKey" type="password" autocomplete="off" placeholder={data.set.mistralKey ? 'задан' : 'нет'} /></label>
    <label class="form-control">HH access token <input class="input input-bordered w-full" name="hhAccessToken" type="password" autocomplete="off" placeholder={data.set.hhAccessToken ? 'задан' : 'нет'} /></label>
    <label class="form-control">HH resume id <input class="input input-bordered w-full" name="hhResumeId" autocomplete="off" placeholder={data.set.hhResumeId ? 'задан' : 'нет'} /></label>
    <button class="btn btn-primary w-fit" type="submit">Сохранить</button>
    {#if form?.saved}<div class="alert alert-success">Сохранено. Обнови страницу, статусы перечитаются.</div>{/if}
  </div>
</form>
