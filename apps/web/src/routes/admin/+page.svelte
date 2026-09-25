<script lang="ts">
let { data, form } = $props();

const link = (name: string) => data.links.find(item => item.name === name);
const telegram = link('Телега');
const mistral = link('Mistral');
const hh = link('HeadHunter');
</script>

<header class="mb-8 flex items-center justify-between">
  <div>
    <h1 class="text-2xl font-semibold">Админка</h1>
    <p class="text-base-content/70">{data.login}</p>
  </div>
  <form method="POST" action="/logout">
    <button class="btn btn-ghost" type="submit">Выйти</button>
  </form>
</header>

<form class="flex flex-col gap-6" method="POST" action="?/save">
  <section class="card bg-base-200">
    <div class="card-body gap-4">
      <div class="flex items-center justify-between gap-3">
        <h2 class="card-title">Телега</h2>
        {#if telegram}
          <span class="badge {telegram.ok ? 'badge-success' : 'badge-error'}">{telegram.detail}</span>
        {/if}
      </div>
      <p class="text-sm text-base-content/70">{data.polling ? 'Бот слушает' : 'Бот молчит'}</p>
      <label class="flex flex-col gap-1 text-sm">
        Токен бота
        <input class="input input-bordered w-full" name="telegramToken" type="password" autocomplete="off" placeholder={data.set.telegramToken ? 'задан' : 'нет'} />
      </label>
    </div>
  </section>

  <section class="card bg-base-200">
    <div class="card-body gap-4">
      <div class="flex items-center justify-between gap-3">
        <h2 class="card-title">Mistral</h2>
        {#if mistral}
          <span class="badge {mistral.ok ? 'badge-success' : 'badge-error'}">{mistral.detail}</span>
        {/if}
      </div>
      <label class="flex flex-col gap-1 text-sm">
        Ключ
        <input class="input input-bordered w-full" name="mistralKey" type="password" autocomplete="off" placeholder={data.set.mistralKey ? 'задан' : 'нет'} />
      </label>
    </div>
  </section>

  <section class="card bg-base-200">
    <div class="card-body gap-4">
      <div class="flex items-center justify-between gap-3">
        <h2 class="card-title">HeadHunter</h2>
        {#if hh}
          <span class="badge {hh.ok ? 'badge-success' : 'badge-error'}">{hh.detail}</span>
        {/if}
      </div>
      <label class="flex flex-col gap-1 text-sm">
        Access token
        <input class="input input-bordered w-full" name="hhAccessToken" type="password" autocomplete="off" placeholder={data.set.hhAccessToken ? 'задан' : 'нет'} />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        Resume id
        <input class="input input-bordered w-full" name="hhResumeId" autocomplete="off" placeholder={data.set.hhResumeId ? 'задан' : 'нет'} />
      </label>
    </div>
  </section>

  <div class="flex flex-col gap-3">
    <p class="text-sm text-base-content/70">Пустое поле не затирает уже сохранённое. Значения обратно не показываются.</p>
    <button class="btn btn-primary w-fit" type="submit">Сохранить</button>
    {#if form?.saved}<div class="alert alert-success">Сохранено. Обнови страницу, статусы перечитаются.</div>{/if}
  </div>
</form>
