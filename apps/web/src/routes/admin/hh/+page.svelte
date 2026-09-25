<script lang="ts">
import SecretForm from '$lib/SecretForm.svelte';

let { data } = $props();
</script>

<header class="mb-6">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">HeadHunter</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Отклики</h1>
  <p class="mt-2 text-sm text-zinc-400">Токен соискателя и id резюме Fullstack. Не работодательский ключ.</p>
</header>

<SecretForm fields={[
  { name: 'hhAccessToken', label: 'Access token', secret: true, set: data.set.hhAccessToken },
  { name: 'hhResumeId', label: 'Resume id', secret: false, set: data.set.hhResumeId },
]} />

<section class="mt-6 rounded-2xl border border-white/8 bg-[#151922] p-5 text-sm leading-6 text-zinc-300">
  <h2 class="text-base font-semibold text-white">Resume id</h2>
  <ol class="mt-3 list-decimal space-y-2 pl-5">
    <li>Открой своё резюме на hh.ru.</li>
    <li>В адресе будет <span class="text-white">https://hh.ru/resume/a1b2c3d4ff0e123456</span>.</li>
    <li>Кусок после <span class="text-white">/resume/</span> и есть id. Вставь только его, без домена и без <span class="text-white">?</span>.</li>
  </ol>
  <h2 class="mt-6 text-base font-semibold text-white">Access token</h2>
  <ol class="mt-3 list-decimal space-y-2 pl-5">
    <li>Открой <span class="text-white">https://dev.hh.ru/admin</span> под тем аккаунтом, с которого откликаешься.</li>
    <li>Добавь приложение. Redirect можно <span class="text-white">http://localhost</span>.</li>
    <li>В карточке приложения возьми Client ID и Client Secret. Это ключи приложения, в админку их не кладём.</li>
    <li>Открой в браузере <span class="text-white">https://hh.ru/oauth/authorize?response_type=code&client_id=ТВОЙ_CLIENT_ID</span> и разреши доступ.</li>
    <li>HH вернёт на redirect с параметром <span class="text-white">code</span>. Обменяй его запросом POST <span class="text-white">https://hh.ru/oauth/token</span> с <span class="text-white">grant_type=authorization_code</span>, client id, client secret и этим code.</li>
    <li>В ответе поле <span class="text-white">access_token</span>. Его и вставляй в Access token. Это длинная строка, не id резюме.</li>
  </ol>
</section>
