<script lang="ts">
import { page } from '$app/stores';

const missing = $derived($page.status === 404);
const underAdmin = $derived(missing && ($page.url.pathname === '/admin' || $page.url.pathname.startsWith('/admin/')));
</script>

<main class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0b0d12] px-6 text-center text-zinc-300 sm:px-8">
  <h1 class="text-base font-normal text-zinc-200">{missing ? 'Такой страницы нет.' : 'Что-то сломалось.'}</h1>
  <a class="btn mt-6" href={underAdmin ? '/admin' : '/'}>{underAdmin ? 'В админку' : 'На главную'}</a>
</main>
