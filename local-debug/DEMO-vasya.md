# Демо: вход под «Вася Пупкин» (DEMO_TOKEN_LOGIN)

Вход по токену рядом с GitHub. Пускает **только** `vasya-pupkin`: токен Романа и любой другой не подходит (тесты `apps/web/demo-login.test.mjs`).
Код: `apps/web/src/lib/server/demo.ts`, `apps/web/src/routes/auth/demo/+server.ts` (POST), форма в `apps/web/src/lib/LoginScene.svelte`.

- Включение: `DEMO_TOKEN_LOGIN=1` + `DEMO_LOGIN_TOKEN=<значение>`. Сервер сравнивает ввод с env через `timingSafeEqual`; в access DB только sha256, привязанный к vasya-pupkin.
- Токен **не показывается** на странице, не печатается и не пишется в логи.
- У Васи своя пустая база `tenants/vasya-pupkin`, лимиты 30/мин и 300/день, наш LLM-ключ не используется (только BYOK / ключи из его цепочки).

## Локально

1. Запуск (пустая папка `/tmp/vasya-demo`, порт 5181):
   `screen -dmS vasya-demo sh -c './local-debug/demo-vasya.sh > /tmp/vasya-demo.log 2>&1'`
   Если `DEMO_LOGIN_TOKEN` не задан, скрипт сам создаёт случайный в `/tmp/vasya-demo/demo-token` (права 600) и ничего не печатает.
2. Открыть http://localhost:5181, в поле «Вход по токену» вставить значение (например `pbcopy < /tmp/vasya-demo/demo-token`, затем Cmd+V) → «Войти».
   Это POST `/auth/demo`; в URL токен не попадает. Неверный токен → `/?token=bad`.
3. Первый вход открывает анкету `/admin/profile?first=1`. Ключ модели: «Модель» → мастер «ключ xAI Grok» → «В цепочку».
4. Расширение: собрать `apps/extension/dist-local`, загрузить распакованным в чистом профиле; сервер: `chrome.storage.local.set({ applySyncUrl: 'http://localhost:5181' })`.
5. Остановить: `screen -S vasya-demo -X quit`. Данные демо: `/tmp/vasya-demo`.

## Прод

Переменные `DEMO_TOKEN_LOGIN=1` и `DEMO_LOGIN_TOKEN` задаются в Railway → Variables. Значение передаётся Роману отдельно, в репозиторий и логи не попадает.
