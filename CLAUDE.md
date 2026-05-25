# AIBOOSTER — заметки для AI-агентов

Краткая сводка для агентов и новых сессий. Полные правила и инварианты —
в [CONSTITUTION.md](./CONSTITUTION.md), читать перед любой работой.

## Стек
- **Фреймворк:** Next.js 15 (App Router), React 19, TypeScript.
- **БД:** Turso (libsql), **standalone (не через Vercel integration)**.
  Vercel-Turso integration при любой перенастройке пересоздаёт БД с нуля
  → история чатов и весь стейт теряются. Прод-БД (`aibooster-prod`) и
  бэкап-БД (`aibooster-backup`) создаются вручную в Turso Console,
  токены подключаются как обычные env-переменные Vercel.
- **AI:** только через aimlapi.com (`AIMLAPI_KEY`), один ключ на все модели.
- **Хостинг:** Vercel.

## Логи и диагностика — начинать отсюда
- Все ошибки → таблица **`app_errors`** (CONSTITUTION §2).
- Дамп логов: `GET /api/admin/errors?token=<ADMIN_TOKEN>&limit=N`.
- UI инспекции схемы/данных: `/admin?token=<ADMIN_TOKEN>`.

## Бэкапы
- `GET /api/admin/backup` — ежедневный Vercel cron (`vercel.json`), копирует
  критичные таблицы в standalone Turso `aibooster-backup`
  (`BACKUP_DATABASE_URL` / `BACKUP_AUTH_TOKEN`).
- Авторизация: `Authorization: Bearer ${CRON_SECRET}` (для cron) или
  `ADMIN_TOKEN` (для ручного вызова).
- Sanity-страховка: если источник пуст, а в бэкапе есть данные — перезапись
  этой таблицы отменяется (защита от db-swap, чтобы не затереть бэкап).
- Канонический список бэкапируемых таблиц — `CRITICAL_TABLES` в
  `app/api/admin/backup/route.ts`. Отсутствующие сейчас (`chat_sessions`,
  `holdings` и пр.) пропускаются молча, заработают как только появятся.

## Алёрт-страж подмены БД
В `lib/db.ts` → `ensureSchema()` после CREATE-DDL вызывается
`checkPossibleDbSwap()`: если `chat_sessions` пуста для `OWNER_UID`,
а `app_settings.last_chat_seen_at` старше часа — пишется запись в
`app_errors` уровня `error` с тегом `possible_db_swap` в `meta`.
Срабатывает один раз на процесс, ошибки внутри не валят `ensureSchema`.

## Переменные окружения
См. `.env.example`. Ключевые:
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` — прод-БД (standalone, не интеграция).
- `BACKUP_DATABASE_URL`, `BACKUP_AUTH_TOKEN` — бэкап-БД (standalone).
- `AIMLAPI_KEY` — единственный AI-шлюз.
- `ADMIN_TOKEN` — служебные эндпоинты и `/admin`.
- `CRON_SECRET` — Vercel cron.
- `OWNER_UID` — единственный пользователь (для alert-стража).
- `BUILD_ID` — попадает в `app_errors.build`.
