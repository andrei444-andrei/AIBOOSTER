// Единый источник правды по схеме БД.
//
// Здесь — и DDL для самопровижининга (CREATE TABLE IF NOT EXISTS), и описания
// таблиц/колонок на русском для служебной страницы /admin. Никакого ORM и
// никакого второго определения этих таблиц быть не должно (см. CONSTITUTION §1.2).

export interface ColumnDef {
  name: string;
  description: string;
}

export interface TableDef {
  name: string;
  description: string;
  ddl: string;
  columns: ColumnDef[];
}

export const TABLES: TableDef[] = [
  {
    name: "app_errors",
    description:
      "Единый сток ошибок проекта (бэкенд + клиент). Точка чтения — GET /api/admin/errors. Имя таблицы закреплено конституцией и неизменно.",
    ddl: `CREATE TABLE IF NOT EXISTS app_errors (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      level TEXT NOT NULL DEFAULT 'error',
      source TEXT NOT NULL,
      route TEXT,
      message TEXT NOT NULL,
      stack TEXT,
      build TEXT,
      user_agent TEXT,
      meta TEXT
    )`,
    columns: [
      { name: "id", description: "Уникальный идентификатор ошибки (UUID). Его же показываем пользователю как error_id для поиска в логе." },
      { name: "ts", description: "Время события (UTC, datetime('now'))." },
      { name: "level", description: "Уровень: error | warn | info." },
      { name: "source", description: "Источник: server | client." },
      { name: "route", description: "Маршрут/эндпоинт, где произошла ошибка." },
      { name: "message", description: "Человекочитаемое сообщение об ошибке." },
      { name: "stack", description: "Стектрейс (если есть)." },
      { name: "build", description: "Идентификатор сборки (BUILD_ID / commit SHA)." },
      { name: "user_agent", description: "User-Agent клиента (для client-ошибок)." },
      { name: "meta", description: "Произвольные доп. данные в формате JSON-строки." },
    ],
  },
  {
    name: "video_translation_jobs",
    description:
      "Задачи перевода YouTube-видео: одна строка = одна попытка перевода (URL + целевой язык). Кешируем по (yt_video_id, target_lang, quality) — повторный запрос на ту же пару отдаёт готовый результат.",
    ddl: `CREATE TABLE IF NOT EXISTS video_translation_jobs (
      id TEXT PRIMARY KEY,
      yt_url TEXT NOT NULL,
      yt_video_id TEXT NOT NULL,
      yt_title TEXT,
      yt_duration_sec INTEGER,
      source_lang TEXT,
      target_lang TEXT NOT NULL,
      quality TEXT NOT NULL DEFAULT 'best',
      status TEXT NOT NULL DEFAULT 'queued',
      stage TEXT,
      progress INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      error_id TEXT,
      audio_url TEXT,
      claimed_at TEXT,
      claimed_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    )`,
    columns: [
      { name: "id", description: "UUID задачи. Используется в URL результата /tools/youtube-translate/j/<id>." },
      { name: "yt_url", description: "Оригинальная ссылка, которую вставил пользователь." },
      { name: "yt_video_id", description: "ID YouTube-видео (11 символов), извлечён из URL." },
      { name: "yt_title", description: "Название ролика (заполняет воркер после метаданных)." },
      { name: "yt_duration_sec", description: "Длительность видео в секундах (после получения метаданных)." },
      { name: "source_lang", description: "Исходный язык речи (ISO-639-1). Определяется ASR/субтитрами, до этого NULL." },
      { name: "target_lang", description: "Целевой язык перевода (ISO-639-1), задаёт пользователь." },
      { name: "quality", description: "Пресет качества: 'fast' | 'best'. 'best' = ElevenLabs multilingual v2." },
      { name: "status", description: "queued | running | done | error | cancelled." },
      { name: "stage", description: "Текущий этап для UI: download | asr | translate | tts | mux." },
      { name: "progress", description: "Прогресс 0..100 для прогрессбара." },
      { name: "error_message", description: "Человекочитаемое сообщение об ошибке (показываем пользователю)." },
      { name: "error_id", description: "ID из app_errors, если ошибка залогирована — для диагностики." },
      { name: "audio_url", description: "URL итогового mp3 на blob-storage (Cloudflare R2), готов когда status='done'." },
      { name: "claimed_at", description: "Когда воркер забрал задачу (для перезапуска зависших job'ов)." },
      { name: "claimed_by", description: "Идентификатор воркера, забравшего задачу." },
      { name: "created_at", description: "Время создания задачи (UTC)." },
      { name: "updated_at", description: "Время последнего апдейта статуса (UTC)." },
      { name: "finished_at", description: "Время финального статуса (done/error/cancelled)." },
    ],
  },
  {
    name: "video_translation_segments",
    description:
      "Сегменты транскрипта/перевода для job'а: каждая фраза с таймкодом. Используется для подсветки в плеере (кликнул на фразу → прыжок на секунду).",
    ddl: `CREATE TABLE IF NOT EXISTS video_translation_segments (
      job_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      source_text TEXT,
      translated_text TEXT,
      PRIMARY KEY (job_id, idx)
    )`,
    columns: [
      { name: "job_id", description: "FK на video_translation_jobs.id." },
      { name: "idx", description: "Порядковый номер сегмента в видео (0..N)." },
      { name: "start_ms", description: "Начало фразы в исходном видео, миллисекунды." },
      { name: "end_ms", description: "Конец фразы, миллисекунды." },
      { name: "source_text", description: "Текст на исходном языке (от ASR/субтитров YouTube)." },
      { name: "translated_text", description: "Перевод этой же фразы на целевой язык." },
    ],
  },

  // --- Модуль «Адаптеры»: системный pull контекста из внешних источников.
  //
  // Идея: для каждого источника (gmail/notion/slack/telegram/gcal/...) есть
  // своя строка в adapter_sources с расписанием и cursor'ом. Vercel Cron раз в
  // минуту вызывает /api/adapters/tick, который для всех due-источников создаёт
  // adapter_sync_jobs. Воркер их разбирает (POST /api/adapters/claim) и тянет
  // инкрементально, пишет в свою per-source таблицу + дублирует нормализованный
  // текст в context_snippets — единый интерфейс для остальных агентов.
  {
    name: "adapter_sources",
    description:
      "Реестр подключённых источников контекста (gmail, notion, slack, telegram, gcal, ...). Одна строка = один источник. Credentials хранятся в plaintext под защитой ADMIN_TOKEN (см. CONSTITUTION §4).",
    ddl: `CREATE TABLE IF NOT EXISTS adapter_sources (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      display_name TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      credentials TEXT,
      cursor TEXT,
      interval_sec INTEGER NOT NULL DEFAULT 600,
      last_run_at TEXT,
      next_run_at TEXT,
      last_error TEXT,
      last_error_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    columns: [
      { name: "id", description: "Идентификатор источника. Для single-instance совпадает с kind ('gmail'), для нескольких аккаунтов — kind + суффикс ('gmail:work')." },
      { name: "kind", description: "Тип источника: 'gmail' | 'notion' | 'slack' | 'telegram' | 'gcal'. Определяет, какой адаптер использовать." },
      { name: "display_name", description: "Человекочитаемое имя для /admin (например, email Gmail-аккаунта или название Notion-воркспейса)." },
      { name: "status", description: "Состояние: 'idle' (готов к синку) | 'syncing' (в работе) | 'error' (последний sync упал) | 'disabled' (cron пропускает)." },
      { name: "credentials", description: "JSON с токенами/секретами источника. Plaintext под ADMIN_TOKEN; не отдавать наружу." },
      { name: "cursor", description: "JSON с состоянием инкрементального pull. Формат свой у каждого адаптера: { history_id } для Gmail, { sync_token } для GCal, { last_ts } и т.п." },
      { name: "interval_sec", description: "Минимальный интервал между sync-запусками источника (секунды)." },
      { name: "last_run_at", description: "Время последнего успешного sync (UTC, ISO)." },
      { name: "next_run_at", description: "Когда tick'у можно ставить следующий job. Индекс по этой колонке = очередь для cron." },
      { name: "last_error", description: "Текст последней ошибки sync (краткий, для /admin)." },
      { name: "last_error_id", description: "ID из app_errors, если ошибка залогирована — для диагностики." },
      { name: "created_at", description: "Когда источник был добавлен (UTC)." },
      { name: "updated_at", description: "Время последнего апдейта строки (UTC)." },
    ],
  },
  {
    name: "adapter_sync_jobs",
    description:
      "Очередь sync-job'ов адаптеров. Cron-tick кладёт сюда задания, воркер забирает через POST /api/adapters/claim. Аналог video_translation_jobs, но кросс-источниковый.",
    ddl: `CREATE TABLE IF NOT EXISTS adapter_sync_jobs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      job_kind TEXT NOT NULL DEFAULT 'pull',
      status TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 0,
      fetched_count INTEGER NOT NULL DEFAULT 0,
      stats TEXT,
      error_message TEXT,
      error_id TEXT,
      claimed_at TEXT,
      claimed_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    )`,
    columns: [
      { name: "id", description: "UUID job'а." },
      { name: "source_id", description: "FK на adapter_sources.id — какой источник синкается." },
      { name: "kind", description: "Дублируется из adapter_sources.kind на момент постановки (gmail/notion/...). Упрощает воркеру роутинг." },
      { name: "job_kind", description: "'pull' — забор данных из источника; 'embed' — нормализация + эмбеддинги для свежих записей." },
      { name: "status", description: "queued | running | done | error | cancelled." },
      { name: "progress", description: "Прогресс 0..100 (для UI/диагностики)." },
      { name: "fetched_count", description: "Сколько записей подтянуто за этот sync (для журнала и /admin)." },
      { name: "stats", description: "JSON с произвольной статистикой sync'а (счётчики по типам объектов и т.п.)." },
      { name: "error_message", description: "Человекочитаемая ошибка, если status='error'." },
      { name: "error_id", description: "ID в app_errors для диагностики." },
      { name: "claimed_at", description: "Когда воркер забрал job (для перезапуска зависших — staleCutoff 30 мин)." },
      { name: "claimed_by", description: "Идентификатор воркера, забравшего job." },
      { name: "created_at", description: "Время создания job'а (UTC)." },
      { name: "updated_at", description: "Время последнего апдейта (UTC)." },
      { name: "finished_at", description: "Время финального статуса (done/error/cancelled)." },
    ],
  },
  {
    name: "adapter_sync_runs",
    description:
      "Журнал завершённых sync-job'ов: для каждого источника видно историю запусков (что когда тянули, сколько, упало ли). Заполняется воркером в момент завершения job'а.",
    ddl: `CREATE TABLE IF NOT EXISTS adapter_sync_runs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      job_kind TEXT NOT NULL,
      job_id TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      duration_ms INTEGER,
      fetched_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      error_message TEXT,
      error_id TEXT
    )`,
    columns: [
      { name: "id", description: "UUID записи журнала." },
      { name: "source_id", description: "FK на adapter_sources.id." },
      { name: "kind", description: "Тип источника на момент запуска (gmail/notion/...)." },
      { name: "job_kind", description: "'pull' | 'embed' — что запускалось." },
      { name: "job_id", description: "FK на adapter_sync_jobs.id (после переноса в журнал сам job может быть удалён)." },
      { name: "started_at", description: "Когда sync начался (claimed_at job'а)." },
      { name: "finished_at", description: "Когда завершился." },
      { name: "duration_ms", description: "Длительность sync'а в миллисекундах." },
      { name: "fetched_count", description: "Сколько записей подтянуто." },
      { name: "status", description: "done | error | cancelled." },
      { name: "error_message", description: "Текст ошибки, если упало." },
      { name: "error_id", description: "ID из app_errors, если ошибка залогирована." },
    ],
  },
  {
    name: "context_snippets",
    description:
      "Единый нормализованный слой контекста для агентов. Каждая сущность источника (письмо/страница/сообщение/событие) превращается ровно в одну строку. Агенты обращаются сюда, а не лазят в per-source таблицы. (source, source_ref) — ключ апсёрта.",
    ddl: `CREATE TABLE IF NOT EXISTS context_snippets (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      ts TEXT NOT NULL,
      title TEXT,
      body TEXT NOT NULL,
      meta TEXT,
      embedding BLOB,
      embedding_model TEXT,
      embedded_at TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (source, source_ref)
    )`,
    columns: [
      { name: "id", description: "UUID сниппета (внутренний)." },
      { name: "source", description: "Источник: 'gmail' | 'notion' | 'slack' | 'telegram' | 'gcal'." },
      { name: "source_ref", description: "Внешний id сущности (message_id / page_id / channel:ts / event_id). Вместе с source — ключ апсёрта." },
      { name: "ts", description: "Когда событие произошло в источнике (UTC, ISO). По этой колонке агенты делают 'recent'." },
      { name: "title", description: "Короткий заголовок (subject письма, title страницы, summary события) — для превью." },
      { name: "body", description: "Нормализованный текст, который пойдёт агенту в контекст. Для длинных текстов — см. context_chunks." },
      { name: "meta", description: "JSON: from/channel/url/labels/attendees — структурированные подсказки для агента." },
      { name: "embedding", description: "Вектор эмбеддинга тела (float32, packed BLOB). NULL, если ещё не посчитан." },
      { name: "embedding_model", description: "Имя модели, которой посчитан embedding (для инвалидаций при смене модели)." },
      { name: "embedded_at", description: "Когда эмбеддинг был посчитан (UTC)." },
      { name: "fetched_at", description: "Когда сниппет впервые сохранён (UTC)." },
      { name: "updated_at", description: "Когда сниппет последний раз обновлён (UTC)." },
    ],
  },
  {
    name: "context_chunks",
    description:
      "Разбивка длинных сниппетов (большие Notion-страницы, длинные письма) на чанки с собственными эмбеддингами — для семантического поиска по фрагментам.",
    ddl: `CREATE TABLE IF NOT EXISTS context_chunks (
      id TEXT PRIMARY KEY,
      snippet_id TEXT NOT NULL,
      chunk_idx INTEGER NOT NULL,
      body TEXT NOT NULL,
      embedding BLOB,
      embedding_model TEXT,
      embedded_at TEXT,
      UNIQUE (snippet_id, chunk_idx)
    )`,
    columns: [
      { name: "id", description: "UUID чанка." },
      { name: "snippet_id", description: "FK на context_snippets.id." },
      { name: "chunk_idx", description: "Порядковый номер чанка в исходном тексте." },
      { name: "body", description: "Текст чанка (обычно ~500-1500 токенов)." },
      { name: "embedding", description: "Эмбеддинг чанка (float32, packed BLOB)." },
      { name: "embedding_model", description: "Имя модели эмбеддинга." },
      { name: "embedded_at", description: "Когда чанк был эмбеднут." },
    ],
  },
];

// Индекс для быстрого чтения последних ошибок.
export const INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_app_errors_ts ON app_errors (ts DESC)`,
  // Кеш: быстрый поиск готовой job'ы по (видео, язык, качество).
  `CREATE INDEX IF NOT EXISTS idx_vtj_cache ON video_translation_jobs (yt_video_id, target_lang, quality, status)`,
  // Очередь: воркер берёт queued по created_at.
  `CREATE INDEX IF NOT EXISTS idx_vtj_queue ON video_translation_jobs (status, created_at)`,
  // Подгрузка сегментов по job'е по порядку.
  `CREATE INDEX IF NOT EXISTS idx_vts_job ON video_translation_segments (job_id, idx)`,

  // Адаптеры: очередь cron'а — какие источники due.
  `CREATE INDEX IF NOT EXISTS idx_adapter_sources_due ON adapter_sources (status, next_run_at)`,
  // Очередь воркера по sync-job'ам.
  `CREATE INDEX IF NOT EXISTS idx_adapter_jobs_queue ON adapter_sync_jobs (status, created_at)`,
  // Поиск job'ов конкретного источника (для дедупликации в tick).
  `CREATE INDEX IF NOT EXISTS idx_adapter_jobs_source ON adapter_sync_jobs (source_id, status)`,
  // Журнал по источнику и времени.
  `CREATE INDEX IF NOT EXISTS idx_adapter_runs_source ON adapter_sync_runs (source_id, finished_at DESC)`,
  // Контекст: 'recent' по времени, опционально с фильтром по source.
  `CREATE INDEX IF NOT EXISTS idx_context_snippets_ts ON context_snippets (ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_context_snippets_source_ts ON context_snippets (source, ts DESC)`,
  // Поиск сниппетов без посчитанного эмбеддинга — для embed-job'а.
  `CREATE INDEX IF NOT EXISTS idx_context_snippets_unembedded ON context_snippets (embedded_at) WHERE embedded_at IS NULL`,
];
