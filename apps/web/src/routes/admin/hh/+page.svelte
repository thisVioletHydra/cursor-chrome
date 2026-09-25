<script lang="ts">
import KeyConnect from '$lib/KeyConnect.svelte';
import Mark from '$lib/Mark.svelte';
import Out from '$lib/Out.svelte';

let { data } = $props();
const link = $derived(data.links.find(item => item.name === 'HeadHunter'));
</script>

<header class="mb-8">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">HeadHunter</p>
  <h1 class="mt-2 text-3xl font-semibold tracking-tight">Отклики</h1>
  <p class="mt-3 max-w-xl text-sm leading-6 text-zinc-400">Токен соискателя и id резюме Fullstack. Одна проверка на оба поля.</p>
</header>

<KeyConnect
  section="hh"
  active={link?.ok === true}
  detail={link?.detail ?? ''}
  wait={data.locks.hh}
  fields={[
    { name: 'hhAccessToken', label: 'Access token', secret: true },
    { name: 'hhResumeId', label: 'Resume id', secret: false },
  ]}
/>

<section class="mt-8 rounded-2xl border border-white/8 bg-[#151922] p-7 text-sm leading-7 text-zinc-300">
  <h2 class="text-base font-semibold text-white">Resume id</h2>
  <ol class="mt-4 list-decimal space-y-4 pl-5">
    <li>Открой <Out href="https://hh.ru/applicant/resumes" text="свои резюме" />.</li>
    <li>Зайди в резюме Fullstack. В адресе будет <Mark text="https://hh.ru/resume/a1b2c3d4ff0e123456" />.</li>
    <li>В поле вставь только кусок после <Mark text="/resume/" />.</li>
  </ol>
  <h2 class="mt-8 text-base font-semibold text-white">Access token</h2>
  <ol class="mt-4 list-decimal space-y-4 pl-5">
    <li>Открой <Out href="https://dev.hh.ru/admin" text="dev.hh.ru/admin" /> тем же соискательским аккаунтом.</li>
    <li>Добавь приложение. Redirect: <Mark text="http://localhost" />.</li>
    <li>Client ID и Client Secret в эту админку не клади. Они нужны только чтобы обменять код.</li>
    <li>Открой <Mark text="https://hh.ru/oauth/authorize?response_type=code&client_id=ТВОЙ_CLIENT_ID" /> и разреши доступ.</li>
    <li>Из адреса <Mark text="http://localhost/?code=..." /> скопируй <Mark text="code" />.</li>
    <li>Обменяй код:</li>
  </ol>
  <pre class="mt-4 overflow-x-auto rounded-xl bg-black/40 p-4 text-xs leading-6 text-orange-200/90">curl -X POST https://hh.ru/oauth/token \
  -d grant_type=authorization_code \
  -d client_id=CLIENT_ID \
  -d client_secret=CLIENT_SECRET \
  -d redirect_uri=http://localhost \
  -d code=CODE</pre>
  <ol class="mt-4 list-decimal space-y-4 pl-5" start="7">
    <li>В ответе возьми <Mark text="access_token" />, не <Mark text="refresh_token" />.</li>
    <li>Вставь оба поля и нажми <Mark text="Проверить" />.</li>
  </ol>
</section>
