<script lang="ts">
import { enhance } from '$app/forms';

import Mark from '$lib/Mark.svelte';

let { data } = $props();
let issued = $state('');
const token = $derived(issued || data.extToken || '');
const connectLink = $derived(token.length > 0 ? `${data.origin}/connect#${token}` : '');

const live = [
  { title: 'Пин и «Поднять HH»', text: 'Рабочая вкладка hh.ru закреплена и не перехватывает фокус. Если её унесло, попап находит её или открывает заново.' },
  { title: 'Очередь', text: '«Разобрать очередь» забирает вакансии с сервера и жмёт «Откликнуться» в твоём залогиненном Chrome. За раз 2–3 штуки, между ними 40–90 секунд.' },
  { title: 'Автопилот в Chrome', text: 'Галка в попапе. Каждые 15 минут, с опозданием до двух с половиной минут, чтобы клики не шли по ровному таймеру.' },
  { title: 'Сопроводительное', text: 'Текст с одноимённой страницы подставляется в отклик при следующем разборе очереди.' },
  { title: 'Карточка на hh.ru', text: 'Угол страницы: сколько сегодня, что ждёт тебя, история. «Показывать поп» в настройках попапа её прячет.' },
  { title: 'Мусор', text: '«Скрывать мусорные вакансии» убирает junior, Angular, PHP, 1C, мобилки, Яндекс и офис в тексте.' },
  { title: 'Сессия', text: 'Выкл: один пин, вкладка переоткрывается. Вкл: тот же адрес и история вкладок.' },
  { title: 'Стоп, если hh не пускает', text: 'Логин, капча, лимит откликов или обязательный тест — пауза до 9:00 по часам этого мака.' },
  { title: 'Вопрос на форме', text: 'Если отклик спрашивает то, чего нет в письме, вкладка отцепляется тебе. В очереди это «ждёт тебя».' },
  { title: 'Приглашения и отказы', text: 'Автопилот заглядывает в отклики и приносит исход на сервер. В телегу уходит сразу, не в общую пачку.' },
];

const later = [
  { title: 'Chrome на связи', text: 'Эта страница не знает, открыт ли Chrome и когда был последний клик. Зелёная галка значит только то, что ссылка выпущена.' },
  { title: 'Автопилот отсюда', text: 'Включить разбор очереди и увидеть паузу до утра можно только в попапе. Сюда галка не дотягивается.' },
  { title: 'Журнал кликов', text: 'История живёт в попапе и на карточке hh.ru. В админке её нет.' },
  { title: 'Ответить на вопрос здесь', text: 'Вакансию, которая ждёт тебя, надо добить на hh. Из админки ответить нельзя.' },
];
</script>

<header class="mb-5">
  <p class="text-xs tracking-wide text-zinc-500 uppercase">Chrome</p>
  <h1 class="mt-1 text-3xl font-semibold tracking-tight">Extension</h1>
  <p class="mt-2 max-w-2xl text-sm text-zinc-400">Клики живут только здесь: в твоём Chrome, на твоей сессии hh. Сервер копит очередь и с закрытой крышкой. Жмать «Откликнуться» он не может. Chrome можно свернуть, закрывать нельзя. Сон мака клики останавливает.</p>
</header>

<section class="rounded-2xl border border-white/8 bg-[#151922] px-5 py-4">
  <h2 class="text-base font-semibold text-white">Подключение</h2>
  {#if connectLink}
    <p class="mt-2 text-sm text-zinc-400">Скопируй ссылку в попап расширения и нажми «Подключить». Потом на hh.ru «Запинить эту» и включи «Автопилот в Chrome».</p>
    <div class="mt-4 flex items-center gap-2">
      <p class="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-zinc-100" title={connectLink}>{connectLink}</p>
      <Mark copy icon text={connectLink} />
    </div>
  {:else}
    <p class="mt-2 text-sm text-zinc-400">Ссылки ещё нет. Выпусти её и вставь в попап расширения.</p>
  {/if}
  <form
    class="mt-4"
    method="POST"
    action="?/extToken"
    use:enhance={() => {
      return async ({ result, update }) => {
        const body = result.type === 'success' ? result.data : null;
        if (body?.ok === true && typeof body.detail === 'string')
          issued = body.detail;

        await update();
      };
    }}
  >
    <button class="btn btn-ghost h-11 min-h-11 px-4" type="submit">
      {token.length > 0 ? 'Новая ссылка' : 'Выпустить ссылку'}
    </button>
    {#if token.length > 0}
      <p class="mt-2 text-xs text-zinc-500">Старая сразу перестанет подходить. В попапе придётся вставить новую.</p>
    {/if}
  </form>
</section>

<section class="mt-4">
  <h2 class="text-base font-semibold text-white">Уже в расширении</h2>
  <p class="mt-2 text-sm text-zinc-400">Это включается в попапе и на hh.ru, не на этой странице.</p>
  <ul class="mt-4 grid gap-3 lg:grid-cols-2">
    {#each live as item}
      <li class="rounded-2xl border border-white/8 bg-[#151922] px-4 py-3">
        <p class="flex items-center gap-2 text-sm font-medium text-zinc-100">
          <span class="size-1.5 shrink-0 rounded-full bg-emerald-400"></span>
          {item.title}
        </p>
        <p class="mt-1.5 text-sm text-zinc-400">{item.text}</p>
      </li>
    {/each}
  </ul>
</section>

<section class="mt-6">
  <h2 class="text-base font-semibold text-white">Ещё нет</h2>
  <p class="mt-2 text-sm text-zinc-400">Хотели и не сделали. Кнопок под этим нет, чтобы не казалось, что уже работает.</p>
  <ul class="mt-4 grid gap-3 lg:grid-cols-2">
    {#each later as item}
      <li class="rounded-2xl border border-dashed border-white/15 bg-[#151922]/60 px-4 py-3">
        <p class="flex items-center gap-2 text-sm font-medium text-zinc-300">
          <span class="size-1.5 shrink-0 rounded-full bg-zinc-500"></span>
          {item.title}
        </p>
        <p class="mt-1.5 text-sm text-zinc-500">{item.text}</p>
      </li>
    {/each}
  </ul>
</section>
