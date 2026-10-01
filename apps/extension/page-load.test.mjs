import { FLIP_MAX_MS, FLIP_MIN_MS, HIDE_MAX_MS, HIDE_MIN_MS, PAGE_LOAD_MS, endedAfter, flipWaitMs, foldLiveLine, hideWaitMs, landedPage, nextListedPage, nextPageNumber, pageLoadMiss, parsedSearch, putSearchPage, searchHasNext, searchReady, searchStep } from './src/search/page-load.ts';
import { pulseLines, waitMark, waitPulse } from './src/pilot/wait-pulse.ts';
import { feedDry, feedEnded, nextDryStreak } from './src/search/feed-dry.ts';
import { descriptionText } from './src/search/vacancy-text.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

test('a search page load times out before a minute', () => {
  assert.equal(PAGE_LOAD_MS < 60_000, true);
  assert.equal(PAGE_LOAD_MS, 45_000);
  assert.equal(pageLoadMiss(PAGE_LOAD_MS), false);
  assert.equal(pageLoadMiss(PAGE_LOAD_MS + 1), true);
  assert.equal(pageLoadMiss(200_000), true);
});

test('a search page flips in a few seconds', () => {
  assert.equal(flipWaitMs(0), FLIP_MIN_MS);
  assert.equal(flipWaitMs(1), FLIP_MAX_MS);
  assert.equal(FLIP_MIN_MS >= 2_000, true);
  assert.equal(FLIP_MAX_MS <= 4_000, true);
  assert.equal(flipWaitMs(0.5) < 10_000, true);
});

test('seen cards open the next page until hh has no next page', () => {
  assert.equal(searchStep({ saved: 0, hasNext: true }), 'more');
  assert.equal(searchStep({ saved: 0, hasNext: false }), 'end');
  assert.equal(searchStep({ saved: 2, hasNext: true }), 'saved');
  assert.equal(searchStep({ saved: 2, hasNext: false }), 'saved');
});

test('a stored flag or an empty body is not a finished hh page', () => {
  assert.equal(parsedSearch(''), false);
  assert.equal(parsedSearch('<doc/>'), false);
  assert.equal(parsedSearch('<html><body>страницы кончились</body></html>'), false);
  assert.equal(pageLoadMiss(PAGE_LOAD_MS + 1), true);
  assert.equal(searchHasNext('<doc/>'), false);
});

test('a live serp is read from cards and the next control', () => {
  const card = '<div data-qa="vacancy-serp__vacancy"></div>';
  const next = '<a data-qa="pager-next"></a>';
  const empty = '<div data-qa="vacancy-search-empty"></div>';
  assert.equal(parsedSearch(card), true);
  assert.equal(searchHasNext(card), false);
  assert.equal(searchStep({ saved: 0, hasNext: searchHasNext(card) }), 'end');
  assert.equal(parsedSearch(`${card}${next}`), true);
  assert.equal(searchHasNext(`${card}${next}`), true);
  assert.equal(searchStep({ saved: 0, hasNext: searchHasNext(next) }), 'more');
  assert.equal(parsedSearch(empty), true);
  assert.equal(searchHasNext(empty), false);
});

test('the search url page goes from 0 to the next hh page', () => {
  assert.equal(nextPageNumber(0), 1);
  assert.equal(nextPageNumber(1), 2);
  const pager = [
    '<a data-qa="pager-page" href="/search/vacancy?text=vue&amp;page=0">1</a>',
    '<a data-qa="pager-page" href="/search/vacancy?text=vue&amp;page=1">2</a>',
  ].join('');
  assert.equal(nextListedPage(pager, 0), 1);
  assert.equal(nextListedPage(pager, 1), null);
  assert.equal(nextListedPage('<a data-qa="pager-next" href="/search/vacancy?text=vue&page=0"></a>', 0), null);
  assert.equal(nextListedPage('<a data-qa="pager-next"></a>', 0), 1);
  const first = putSearchPage('https://hh.ru/search/vacancy?text=vue&search_period=3&order_by=publication_time', 0);
  const second = putSearchPage(first, nextPageNumber(0));
  assert.equal(new URL(first).searchParams.get('page'), '0');
  assert.equal(new URL(second).searchParams.get('page'), '1');
  assert.notEqual(first, second);
  assert.equal(searchStep({ saved: 0, hasNext: nextListedPage(pager, 0) !== null }), 'more');
  assert.equal(searchStep({ saved: 0, hasNext: nextListedPage(pager, 1) !== null }), 'end');
});

test('a finished hide sits from one to eight seconds', () => {
  assert.equal(hideWaitMs(0), 1_000);
  assert.equal(hideWaitMs(1 / 8), 2_000);
  assert.equal(hideWaitMs(2 / 8), 3_000);
  assert.equal(hideWaitMs(3 / 8), 4_000);
  assert.equal(hideWaitMs(4 / 8), 5_000);
  assert.equal(hideWaitMs(5 / 8), 6_000);
  assert.equal(hideWaitMs(6 / 8), 7_000);
  assert.equal(hideWaitMs(7 / 8), 8_000);
  assert.equal(hideWaitMs(1), 8_000);
  assert.equal(HIDE_MIN_MS, 1_000);
  assert.equal(HIDE_MAX_MS, 8_000);
  assert.equal(hideWaitMs(Number.NaN), 1_000);
  assert.equal(hideWaitMs(2), 8_000);
});

test('the first hh page has no page param and still counts', () => {
  const html = '<div data-qa="vacancy-serp__vacancy"></div>';
  assert.equal(searchReady('https://hh.ru/search/vacancy?text=Frontend', html, 'Frontend', 0, false), true);
  assert.equal(searchReady('https://hh.ru/search/vacancy?text=Frontend', html, 'Vue.js', 0, false), false);
  assert.equal(searchReady('https://hh.ru/search/vacancy?text=Frontend', html, 'Frontend', 2, false), false);
});

test('the saved feed counts without a text query', () => {
  const html = '<div data-qa="vacancy-serp__vacancy"></div>';
  const feed = 'https://hh.ru/search/vacancy?enable_snippets=true&ored_clusters=true&search_period=7&hhtmFrom=vacancy_search_list';
  assert.equal(searchReady(feed, html, '', 0, false), true);
  assert.equal(searchReady(`${feed}&page=2`, html, '', 2, false), true);
  assert.equal(searchReady('https://hh.ru/search/vacancy?text=Fullstack&page=20', html, '', 0, false), false);
  assert.equal(searchReady('https://hh.ru/search/vacancy', html, '', 0, false), true);
  assert.equal(searchReady(`${feed}&text=JavaScript`, html, '', 0, false), true);
});

test('a clamped deep page counts after the address changes', () => {
  const html = '<div data-qa="vacancy-serp__vacancy"></div>';
  const url = 'https://hh.ru/search/vacancy?text=Frontend&page=4';
  assert.equal(searchReady(url, html, 'Frontend', 20, true), true);
  assert.equal(searchReady(url, html, 'Frontend', 20, false), false);
  assert.equal(searchReady(url, html, 'Frontend', 4, false), true);
});

test('hh clamps a deep cursor onto the page it actually opened', () => {
  assert.equal(landedPage('https://hh.ru/search/vacancy?text=vue&page=4', 20), 4);
  assert.equal(landedPage('https://hh.ru/search/vacancy?text=vue', 0), 0);
  assert.equal(landedPage('https://hh.ru/search/vacancy?page=0', 0), 0);
});

test('pages ended is one line until a later cycle finds cards or a next page', () => {
  const first = endedAfter(false, { fresh: false, hasNext: false });
  assert.equal(first.say, true);
  assert.equal(first.quiet, true);
  const again = endedAfter(first.quiet, { fresh: false, hasNext: false });
  assert.equal(again.say, false);
  const opened = endedAfter(again.quiet, { fresh: false, hasNext: true });
  assert.equal(opened.say, false);
  assert.equal(opened.quiet, false);
  const saved = endedAfter(true, { fresh: true, hasNext: false });
  assert.equal(saved.say, true);
  assert.equal(saved.quiet, true);
});

test('a live wait replaces one line', () => {
  assert.deepEqual(foldLiveLine(['жду страницу, 1 с'], 'жду страницу, 2 с'), ['жду страницу, 2 с']);
  assert.deepEqual(foldLiveLine(['жду 14'], 'жду страницу, 1 с'), ['жду страницу, 1 с']);
  assert.deepEqual(foldLiveLine(['ищу вакансию'], 'ищу вакансию, 1 с'), ['ищу вакансию, 1 с']);
  assert.deepEqual(foldLiveLine(['жду страницу, 1 с'], 'жду страницу, 1 с'), ['жду страницу, 1 с']);
  assert.deepEqual(
    foldLiveLine(['уже видели, 20'], 'жду страницу, 1 с'),
    ['уже видели, 20', 'жду страницу, 1 с'],
  );
});

test('a named wait replaces the same pulse', () => {
  const hide = waitMark({
    id: 'hide.wait',
    human: 'скрытие',
    budget: 8,
    next: 'hide.look',
    hold: true,
  });
  const first = waitPulse(hide, 3);
  const next = waitPulse(hide, 4);
  assert.equal(first.length <= 80, true);
  assert.deepEqual(pulseLines(first), [
    'пауза после скрытия',
    '3 из 8 с',
    'потом: проверю, закрылось ли меню',
    'hh-search.ts',
  ]);
  assert.deepEqual(foldLiveLine(['жду 29'], first), [first]);
  assert.deepEqual(foldLiveLine([first], next), [next]);
  assert.deepEqual(foldLiveLine(['уже видели, 20'], first), ['уже видели, 20', first]);
  const hunt = waitPulse(waitMark({
    id: 'search.hunt',
    human: 'ищу вакансию',
    budget: null,
    next: 'search.load',
    kind: 's',
  }), 12);
  assert.deepEqual(pulseLines(hunt), [
    'ищу вакансию в ленте',
    '12 с',
    'потом: жду загрузку страницы hh',
    'hh-search.ts',
  ]);
});

test('three junk vacancies in a row end the feed, a stack title resets', () => {
  assert.equal(feedDry('Водитель-курьер', ''), true);
  assert.equal(feedDry('Начинающий риелтор/Помощник риелтора', ''), true);
  assert.equal(feedDry('Начинающий агент по недвижимости', ''), true);
  assert.equal(feedDry('Менеджер по продажам', 'нужен JavaScript'), true);
  assert.equal(feedDry('Специалист разметки данных', 'киргизский язык'), true);
  assert.equal(feedDry('Разработчик React', 'ДБО, GraphQL'), false);
  assert.equal(feedDry('Фронтенд', 'в команде есть менеджер продукта'), false);

  let streak = 0;
  streak = nextDryStreak(streak, 'Водитель-курьер', '');
  streak = nextDryStreak(streak, 'Начинающий риелтор', '');
  assert.equal(feedEnded(streak), false);
  streak = nextDryStreak(streak, 'Методолог (IT)', '');
  assert.equal(feedEnded(streak), true);
  assert.equal(nextDryStreak(streak, 'Разработчик React', 'TypeScript'), 0);
});

test('the vacancy description does not swallow the jobs under it', () => {
  const html = [
    '<div data-qa="vacancy-description"><div><p>React и GraphQL. Удалённо по РФ.</p></div></div>',
    '<div>PHP Python стажёр</div>',
  ].join('');
  const text = descriptionText(html);
  assert.equal(text.includes('React'), true);
  assert.equal(text.includes('PHP'), false);
  assert.equal(text.includes('стажёр'), false);
});
