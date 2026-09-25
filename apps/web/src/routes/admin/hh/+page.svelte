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
</header>

<KeyConnect
  section="hh"
  active={link?.ok === true}
  detail={link?.detail ?? ''}
  wait={data.locks.hh}
  resumeId={data.resumeId}
  fields={[
    { name: 'hhAccessToken', label: 'Access token', secret: true },
    { name: 'hhResumeId', label: 'Резюме', secret: false, url: true },
  ]}
/>

<section class="mt-8 rounded-2xl border border-white/8 bg-[#151922] p-7 text-sm leading-7 text-zinc-300">
  <h2 class="text-base font-semibold text-white">Резюме</h2>
  <ol class="mt-4 list-decimal space-y-4 pl-5">
    <li>Жми <Out href="https://hh.ru/applicant/resumes" text="свои резюме" /> и открой Fullstack.</li>
    <li>Скопируй адресную строку и вставь в поле.</li>
  </ol>
  <h2 class="mt-8 text-base font-semibold text-white">Access token</h2>
  <ol class="mt-4 list-decimal space-y-4 pl-5">
    <li>Жми <Out href="https://dev.hh.ru/admin" text="dev.hh.ru/admin" />. Добавь приложение. Redirect: <Mark text="http://localhost" />.</li>
    <li>В ссылку подставь Client ID и жми её. Разреши доступ. <Mark text="https://hh.ru/oauth/authorize?response_type=code&client_id=ТВОЙ_CLIENT_ID" /></li>
    <li>Со страницы <Mark text="http://localhost/?code=..." /> скопируй <Mark text="code" />.</li>
    <li>Вставь в терминал, подставив свои значения. В ответе бери <Mark text="access_token" />.</li>
    <li>Вставь оба поля сверху и жми <Mark text="Проверить" />.</li>
  </ol>
  <pre class="mt-4 overflow-x-auto rounded-xl bg-black/40 p-4 text-xs leading-6 text-orange-200/90">curl -X POST https://hh.ru/oauth/token \
  -d grant_type=authorization_code \
  -d client_id=CLIENT_ID \
  -d client_secret=CLIENT_SECRET \
  -d redirect_uri=http://localhost \
  -d code=CODE</pre>
</section>
