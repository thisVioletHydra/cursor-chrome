# Демо: вход под «Вася Пупкин» (DEMO_TOKEN_LOGIN)

Временный вход по токену в обход GitHub. Весь код помечен `DEMO_TOKEN_LOGIN`; вырезать: `apps/web/src/routes/auth/demo/`, блок `DEMO_*` в `apps/web/src/lib/server/access.ts`, `local-debug/demo-vasya.sh`, этот файл.
Аккаунт Романа не участвует: демо-сервер работает на пустой папке `/tmp/vasya-demo` и порту 5181, а не на local-debug/data.

1. Запустить демо-сервер:
   `screen -dmS vasya-demo sh -c './local-debug/demo-vasya.sh > /tmp/vasya-demo.log 2>&1'` и открыть http://localhost:5181.
2. Выдать Васе токен (печатается один раз, в БД только хэш):
   `ACCESS_DB=/tmp/vasya-demo/access.sqlite node local-debug/access-token.mjs issue vasya-pupkin "Вася Пупкин"`
3. Админка: открыть `http://localhost:5181/auth/demo?token=<токен>`. Профиль пустой, поэтому откроется анкета `/admin/profile?first=1`. Debug-панель доступа: `/admin/access`.
4. Расширение: собрать в `apps/extension/dist-local` (см. отчёт), в Chrome на чистом профиле: chrome://extensions → режим разработчика → «Загрузить распакованное» → `dist-local`. Открыть «Параметры» расширения.
   Вкладка Profile — анкета; вкладка Debug — вставить токен, «Save & check». Чтобы расширение знало сервер: в консоли страницы параметров `chrome.storage.local.set({ applySyncUrl: 'http://localhost:5181' })`.
5. Debug показывает: deviceId, каждый признак (сырое значение — только локально, хэш — уходит), скор и причину, слот, пропуск на 4 часа, тело последнего запроса без ключей, что осталось локально, лог.
6. Управление: `node local-debug/access-token.mjs list | revoke <id> | unbind <id> <slot>` (с тем же ACCESS_DB), либо кнопка Unbind в `/admin/access`.
7. Остановить: `screen -S vasya-demo -X quit`. Данные демо: `/tmp/vasya-demo`.
