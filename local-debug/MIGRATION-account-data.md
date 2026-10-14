# Перенос личных данных в аккаунт — чеклист перед деплоем на прод

После этого изменения в коде нет личных данных: факты, canon-seed, зарплата, контакты и сопроводительное
письмо лежат в файле аккаунта (`<accounts>/<login>.json`, поля `facts`, `canonSeed`, `profile`, `coverLetter`).
На проде эти поля сейчас пустые. Если задеплоить без миграции, бот перестанет знать факты, а на вопросы о зарплате и контактах будет отвечать NEED_HUMAN. Письмо будет пустым.

## До деплоя
1. Локально собрать источник: `local-debug/data/review/accounts/thisVioletHydra.json` (уже содержит всё) или
   отдельный JSON только с нужными полями (`local-debug/backups/roman-account-source.json`: profile + coverLetter).
   Ключи и модели из источника НЕ переносятся (скрипт трогает только 4 поля).
2. Сделать бэкап прод-тома: `/data/accounts/<login>.json` (и вообще `/data`).
3. Скопировать файл-источник на прод-том (например `/data/migrate-source.json`). В git его не класть.
4. Dry-run: `node migrate-account-data.mjs --source /data/migrate-source.json --target /data/accounts/<login>.json`.
   Вывод — только имена полей и счётчики (set/merge/keep/skip), значений нет.
5. `--apply`. Скрипт сам сделает `<target>.bak-<ts>` и запишет атомарно. Повторный запуск должен показать «изменений нет».
   Ограничить поля можно так: `--only facts,canonSeed`.
6. Удалить `/data/migrate-source.json`.

## Деплой и проверка
7. Деплой. На старте сервер вызывает `applyAccount` из `applySavedSecrets` → FACTS / COVER_LETTER / ANSWER_HINTS.
8. Проверить, что `/admin/config` показывает письмо, `/admin/profile` содержит поля salary, salaryNumber и contacts, а в `/admin/memory` лежит канон портфолио
   (он засеивается при первом открытии `/admin/review`).
9. CLI (`pnpm scan`) читает аккаунт владельца: `HH_ACCOUNT_FILE` или `<accounts>/<HH_OWNER|OWNER>.json`
   (accounts = `HH_ACCOUNTS_DIR` | `WEB_SECRETS`-dir/accounts | `/data/accounts` на Railway | `./data/accounts`).
   В stderr пишется путь и счётчики.

## Откат
Вернуть `<target>.bak-<ts>` на место `<target>` и перезапустить сервис.

## Не покрыто
- `apps/extension/src/hh/letter.ts` хранит свою копию письма (не трогали).
- `apps/hh/src/model/facts.data.ts` и `apps/hh/scripts/` (sync-facts) — чужие незакоммиченные файлы, не трогали.
