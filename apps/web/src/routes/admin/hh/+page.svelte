<script lang="ts">
import SecretForm from '$lib/SecretForm.svelte';

let { data } = $props();
const link = $derived(data.links.find(item => item.name === 'HeadHunter'));
</script>

<header class="mb-6">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">HeadHunter</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Отклики</h1>
  <p class="mt-2 text-sm text-zinc-400">Нужны токен соискателя и id резюме Fullstack. Ключ работодателя сюда не подходит.</p>
  {#if link}
    <p class="mt-3 flex items-center gap-2 text-sm text-zinc-300">
      <span class="size-2.5 rounded-full {link.ok ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]' : 'bg-rose-400'}"></span>
      {link.detail}
    </p>
  {/if}
</header>

<SecretForm fields={[
  { name: 'hhAccessToken', label: 'Access token', secret: true, set: data.set.hhAccessToken },
  { name: 'hhResumeId', label: 'Resume id', secret: false, set: data.set.hhResumeId },
]} />

<section class="mt-6 rounded-2xl border border-white/8 bg-[#151922] p-5 text-sm leading-6 text-zinc-300">
  <h2 class="text-base font-semibold text-white">Resume id</h2>
  <ol class="mt-3 list-decimal space-y-3 pl-5">
    <li>Открой <a class="text-indigo-300" href="https://hh.ru/applicant/resumes" target="_blank" rel="noreferrer">свои резюме</a> под аккаунтом, с которого откликаешься.</li>
    <li>Зайди в резюме Fullstack. В адресе будет <span class="text-white">https://hh.ru/resume/a1b2c3d4ff0e123456</span>.</li>
    <li>В поле Resume id вставь только кусок после <span class="text-white">/resume/</span>. Без домена и без <span class="text-white">?</span>.</li>
  </ol>
  <h2 class="mt-6 text-base font-semibold text-white">Access token</h2>
  <ol class="mt-3 list-decimal space-y-3 pl-5">
    <li>Открой <a class="text-indigo-300" href="https://dev.hh.ru/admin" target="_blank" rel="noreferrer">dev.hh.ru/admin</a> тем же соискательским аккаунтом. Это не кабинет работодателя.</li>
    <li>Добавь приложение. Имя любое. Redirect: <span class="text-white">http://localhost</span>.</li>
    <li>В карточке приложения скопируй Client ID и Client Secret. В эту админку их не клади, они нужны только на шаг обмена.</li>
    <li>В браузере открой <span class="text-white">https://hh.ru/oauth/authorize?response_type=code&amp;client_id=ТВОЙ_CLIENT_ID</span> и разреши доступ.</li>
    <li>HH уведёт на <span class="text-white">http://localhost/?code=...</span>. Страница может не открыться, это нормально. Из адресной строки скопируй значение <span class="text-white">code</span>.</li>
    <li>Обменяй code на токен. В терминале, подставив свои значения:</li>
  </ol>
  <pre class="mt-3 overflow-x-auto rounded-xl bg-black/40 p-3 text-xs text-zinc-200">curl -X POST https://hh.ru/oauth/token \
  -d grant_type=authorization_code \
  -d client_id=CLIENT_ID \
  -d client_secret=CLIENT_SECRET \
  -d redirect_uri=http://localhost \
  -d code=CODE</pre>
  <ol class="mt-3 list-decimal space-y-3 pl-5" start="7">
    <li>В ответе возьми <span class="text-white">access_token</span>, не <span class="text-white">refresh_token</span>. Это длинная строка, не id резюме.</li>
    <li>Вставь в Access token и кликни мимо. Карточка на обзоре зелёная, только когда живы и токен, и резюме.</li>
  </ol>
</section>
