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
    name: "apify_actors",
    description:
      "Реестр актеров Apify, которыми владеет приложение. Заполняется автоматически (самопровижининг по §1 конституции): когда какой-то модуль впервые запрашивает актер по slug — лезем в Apify, ищем или создаём, и пишем сюда. APIFY_RUNNER_ACTOR_ID в env не нужен.",
    ddl: `CREATE TABLE IF NOT EXISTS apify_actors (
      slug TEXT PRIMARY KEY,
      apify_actor_id TEXT NOT NULL,
      apify_actor_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_built_at TEXT
    )`,
    columns: [
      { name: "slug", description: "Внутренний ключ (например 'runner'). По нему обращается код модуля." },
      { name: "apify_actor_id", description: "Канонический ID в Apify в форме 'username~actor-name' (либо короткий random ID, оба работают)." },
      { name: "apify_actor_name", description: "Имя актера в Apify (то, что показано в Console)." },
      { name: "created_at", description: "Когда впервые задеплоили/обнаружили." },
      { name: "last_built_at", description: "Когда мы инициировали build (для будущей логики обновления при изменении исходников)." },
    ],
  },
  {
    name: "scraper_runs",
    description:
      "Запуски модуля AI Scraper. Каждый запуск — связка «пользовательский промпт → AI-сгенерированный код → запуск нашего Apify-актера → результат». Один ряд = один логический запуск (может содержать несколько попыток в scraper_attempts).",
    ddl: `CREATE TABLE IF NOT EXISTS scraper_runs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      apify_run_id TEXT,
      apify_dataset_id TEXT,
      result_count INTEGER,
      result_summary TEXT,
      error_id TEXT,
      error_message TEXT
    )`,
    columns: [
      { name: "id", description: "UUID запуска. Используется в URL /scraper/[id] и в логах." },
      { name: "created_at", description: "Когда юзер нажал «запустить»." },
      { name: "updated_at", description: "Когда статус последний раз менялся (поллинг Apify)." },
      { name: "prompt", description: "Исходный текст задачи от пользователя." },
      { name: "status", description: "pending | planning | running | succeeded | failed. Финальные — succeeded/failed." },
      { name: "apify_run_id", description: "ID run-а в Apify (для просмотра в их консоли и API)." },
      { name: "apify_dataset_id", description: "ID Apify Dataset с собранными данными." },
      { name: "result_count", description: "Количество элементов в датасете после успешного завершения." },
      { name: "result_summary", description: "Markdown-выжимка от LLM по итогам (топы, срезы, инсайты)." },
      { name: "error_id", description: "Ссылка на app_errors.id, если что-то взорвалось." },
      { name: "error_message", description: "Короткое сообщение об ошибке для UI (понятное юзеру)." },
    ],
  },
  {
    name: "scraper_attempts",
    description:
      "Попытки внутри одного scraper_runs. Сейчас у запуска одна попытка (MVP без self-healing), но таблица заведена сразу, чтобы потом подключить retry-цикл без миграции.",
    ddl: `CREATE TABLE IF NOT EXISTS scraper_attempts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      n INTEGER NOT NULL,
      code TEXT NOT NULL,
      reasoning TEXT,
      apify_run_id TEXT,
      items_count INTEGER,
      error TEXT,
      FOREIGN KEY (run_id) REFERENCES scraper_runs(id)
    )`,
    columns: [
      { name: "id", description: "UUID попытки." },
      { name: "run_id", description: "К какому scraper_runs относится." },
      { name: "created_at", description: "Когда AI сгенерировал и отправил код." },
      { name: "n", description: "Номер попытки (1, 2, 3...) — для будущего self-healing цикла." },
      { name: "code", description: "JavaScript-код, который AI сгенерировал под наш runner-SDK." },
      { name: "reasoning", description: "Короткое объяснение от AI: что и как делает код." },
      { name: "apify_run_id", description: "ID этого конкретного run-а на стороне Apify." },
      { name: "items_count", description: "Сколько строк попало в датасет (0 — индикатор сломанных селекторов)." },
      { name: "error", description: "Текст ошибки, если попытка упала." },
    ],
  },
  {
    name: "scraper_catalog",
    description:
      "Каталог идей: подсмотренные актеры из публичного Apify Store, переведённые и обогащённые. UX-помощник для модуля /scraper — показывает «что я умею», даёт примеры промптов, по клику пред-заполняет форму. Источник для UI, НЕ для прямых запусков. Заполняется через POST /api/admin/scraper/sync-catalog.",
    ddl: `CREATE TABLE IF NOT EXISTS scraper_catalog (
      apify_actor_id TEXT PRIMARY KEY,
      actor_name TEXT NOT NULL,
      canonical TEXT NOT NULL,
      title TEXT NOT NULL,
      title_ru TEXT,
      description TEXT,
      description_ru TEXT,
      category TEXT,
      category_ru TEXT,
      target_sites TEXT,
      example_prompts TEXT,
      apify_url TEXT,
      stats_users INTEGER,
      stats_total_runs INTEGER,
      last_synced_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    columns: [
      { name: "apify_actor_id", description: "Короткий ID актера в Apify (random string). Уникален." },
      { name: "actor_name", description: "Имя актера (slug-часть URL)." },
      { name: "canonical", description: "Канонический ID в форме 'username~name', удобен для API-вызовов." },
      { name: "title", description: "Оригинальный заголовок (как в Store)." },
      { name: "title_ru", description: "Короткое русское название (1-5 слов), сгенерировано LLM." },
      { name: "description", description: "Оригинальное описание из Apify." },
      { name: "description_ru", description: "Перевод/пересказ на русском в 1-2 предложениях. От LLM." },
      { name: "category", description: "Категория Apify (ECOMMERCE, SOCIAL_MEDIA, ...)." },
      { name: "category_ru", description: "Категория на русском (Маркетплейсы, Соцсети, ...)." },
      { name: "target_sites", description: "JSON-массив строк: какие сайты умеет (hh.ru, ozon.ru, ...). Извлекает LLM из описания." },
      { name: "example_prompts", description: "JSON-массив объектов {label, prompt} — 1-3 примеров запросов на русском, которые пользователь может скопировать. От LLM." },
      { name: "apify_url", description: "Прямая ссылка на актер в Apify Console (для любопытных)." },
      { name: "stats_users", description: "Сколько пользователей запускало этот актер (фильтр мусора)." },
      { name: "stats_total_runs", description: "Сколько раз запускали (показатель популярности)." },
      { name: "last_synced_at", description: "Когда наш sync обновлял эту запись." },
      { name: "created_at", description: "Когда запись впервые появилась в БД." },
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

  // Per-source таблицы. Идея: raw данные как есть + минимально нормализованные
  // поля для индексов. Полный API-ответ — в колонке raw (JSON), чтобы при
  // изменении схемы не нужно было пересинкивать.
  {
    name: "gmail_messages",
    description:
      "Письма Gmail. Одна строка = одно письмо. Заполняется адаптером Gmail инкрементально через users.history.list. Raw содержит полный ответ users.messages.get для отладки.",
    ddl: `CREATE TABLE IF NOT EXISTS gmail_messages (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      thread_id TEXT,
      history_id TEXT,
      internal_date TEXT,
      from_addr TEXT,
      to_addrs TEXT,
      cc TEXT,
      subject TEXT,
      snippet TEXT,
      body_text TEXT,
      labels TEXT,
      has_attachments INTEGER NOT NULL DEFAULT 0,
      raw TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    columns: [
      { name: "id", description: "Gmail message id (RFC 822 id внутри Gmail)." },
      { name: "source_id", description: "FK на adapter_sources.id — какой gmail-аккаунт (для multi-account)." },
      { name: "thread_id", description: "Идентификатор треда Gmail." },
      { name: "history_id", description: "history_id, при котором письмо появилось — для инкрементального sync." },
      { name: "internal_date", description: "Время доставки в Gmail (UTC, ISO; источник — internalDate в ms)." },
      { name: "from_addr", description: "Заголовок From целиком (например, 'Имя <addr@host>')." },
      { name: "to_addrs", description: "Заголовок To (одной строкой)." },
      { name: "cc", description: "Заголовок Cc." },
      { name: "subject", description: "Тема письма." },
      { name: "snippet", description: "Превью от Gmail (~120 символов)." },
      { name: "body_text", description: "Плоский текст тела (text/plain или конвертированный из text/html)." },
      { name: "labels", description: "JSON-массив label-id (INBOX, IMPORTANT, CATEGORY_*, ...)." },
      { name: "has_attachments", description: "1 если в письме есть вложения (по multipart-частям с filename)." },
      { name: "raw", description: "JSON полного ответа Gmail users.messages.get — для дебага/реиндекса." },
      { name: "fetched_at", description: "Когда впервые сохранено." },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // Модуль AI Chat
  // ────────────────────────────────────────────────────────────────────
  {
    name: "chat_sessions",
    description:
      "Сессия (один чат). Группируется по uid пользователя (анонимный, из localStorage). Хранит выбор пользователя (модель ИЛИ категория-пресет ИЛИ ничего = Auto) и заголовок.",
    ddl: `CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Новый чат',
      model TEXT NOT NULL,
      model_override TEXT,
      category_override TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    columns: [
      { name: "id", description: "UUID сессии." },
      { name: "uid", description: "Анонимный идентификатор владельца (chat_uid из localStorage)." },
      { name: "title", description: "Заголовок чата (первая строка первого сообщения или ручная)." },
      { name: "model", description: "Последняя фактически использованная модель в сессии (для дисплея в сайдбаре)." },
      { name: "model_override", description: "Если задано — модель, выбранная пользователем явно (стикает в чате до сброса). Имеет приоритет над category_override." },
      { name: "category_override", description: "Если задано — пресет-категория из 6 (quick/research/code/analyze/strategy/image). Берёт модель и параметры из chat_category_routing." },
      { name: "created_at", description: "Когда создана." },
      { name: "updated_at", description: "Когда было последнее сообщение." },
    ],
  },
  {
    name: "chat_category_routing",
    description:
      "Маршрутизация категорий задач на модели. По одной строке для каждой из 6 категорий: quick / research / code / analyze / strategy / image. Auto-роутер и пресеты в селекторе модели читают эту таблицу. Редактируется в /admin/chat.",
    ddl: `CREATE TABLE IF NOT EXISTS chat_category_routing (
      category TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      reasoning_effort TEXT,
      max_tokens INTEGER NOT NULL DEFAULT 4000,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    columns: [
      { name: "category", description: "Идентификатор категории: quick | research | code | analyze | strategy | image." },
      { name: "model", description: "Идентификатор модели AIMLAPI для этой категории." },
      { name: "reasoning_effort", description: "Уровень reasoning для reasoning-моделей (gpt-5*, grok-4, deepseek-r1): minimal | low | medium | high. NULL — не передавать." },
      { name: "max_tokens", description: "Лимит токенов ответа." },
      { name: "created_at", description: "Когда создана строка." },
      { name: "updated_at", description: "Когда правили." },
    ],
  },
  {
    name: "chat_messages",
    description:
      "Сообщения чата в хронологическом порядке. Хранятся все: и пользовательские, и ответы модели — для контекста и анализа.",
    ddl: `CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      tokens_prompt INTEGER,
      tokens_completion INTEGER,
      duration_ms INTEGER,
      route_meta TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    columns: [
      { name: "id", description: "UUID сообщения." },
      { name: "session_id", description: "FK на chat_sessions.id." },
      { name: "role", description: "user | assistant | system." },
      { name: "content", description: "Текст сообщения (markdown для assistant)." },
      { name: "model", description: "Какой моделью сгенерировано (для assistant)." },
      { name: "tokens_prompt", description: "Токены промта по отчёту AIMLAPI (если есть)." },
      { name: "tokens_completion", description: "Токены ответа по отчёту AIMLAPI (если есть)." },
      { name: "duration_ms", description: "Сколько мс заняла генерация ответа (для assistant)." },
      { name: "route_meta", description: "JSON с решением роутера: category, complexity, source, reasoning_effort." },
      { name: "created_at", description: "Когда отправлено." },
    ],
  },
  {
    name: "chat_attachments",
    description:
      "Файлы, прикреплённые к сообщениям (и пользовательским, и assistant — для сгенерированных картинок). Текст — content_text, изображения — content_base64 без data: префикса.",
    ddl: `CREATE TABLE IF NOT EXISTS chat_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      kind TEXT NOT NULL,
      content_text TEXT,
      content_base64 TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    columns: [
      { name: "id", description: "UUID вложения." },
      { name: "message_id", description: "FK на chat_messages.id." },
      { name: "filename", description: "Имя файла как у пользователя." },
      { name: "mime_type", description: "MIME-тип." },
      { name: "size", description: "Размер в байтах." },
      { name: "kind", description: "text | image — определяет, как подмешивать в промт." },
      { name: "content_text", description: "Содержимое для текстовых вложений (UTF-8)." },
      { name: "content_base64", description: "Содержимое для изображений (base64 без data: префикса)." },
      { name: "created_at", description: "Когда загружено." },
    ],
  },
  {
    name: "chat_settings",
    description:
      "Единственная строка с настройками модуля чата: системный промт и набор разрешённых блоков форматирования. Редактируется в /admin/chat.",
    ddl: `CREATE TABLE IF NOT EXISTS chat_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      system_prompt TEXT NOT NULL DEFAULT '',
      enabled_blocks TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    columns: [
      { name: "id", description: "Всегда 1 — настройки одни на инсталляцию." },
      { name: "system_prompt", description: "Системный промт, который добавляется поверх каждой сессии." },
      { name: "enabled_blocks", description: "JSON: какие типы markdown-блоков разрешены." },
      { name: "created_at", description: "Когда строка появилась." },
      { name: "updated_at", description: "Когда была последняя правка." },
    ],
  },
];

// Индексы для быстрого чтения.
export const INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_app_errors_ts ON app_errors (ts DESC)`,

  // AI Scraper: списки запусков и попыток + каталог.
  `CREATE INDEX IF NOT EXISTS idx_scraper_runs_created ON scraper_runs (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_scraper_attempts_run ON scraper_attempts (run_id, n)`,
  `CREATE INDEX IF NOT EXISTS idx_scraper_catalog_category ON scraper_catalog (category_ru, stats_users DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_scraper_catalog_users ON scraper_catalog (stats_users DESC)`,

  // YouTube-перевод: кеш + очередь + сегменты.
  `CREATE INDEX IF NOT EXISTS idx_vtj_cache ON video_translation_jobs (yt_video_id, target_lang, quality, status)`,
  `CREATE INDEX IF NOT EXISTS idx_vtj_queue ON video_translation_jobs (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_vts_job ON video_translation_segments (job_id, idx)`,

  // Адаптеры: очередь cron'а — какие источники due.
  `CREATE INDEX IF NOT EXISTS idx_adapter_sources_due ON adapter_sources (status, next_run_at)`,
  `CREATE INDEX IF NOT EXISTS idx_adapter_jobs_queue ON adapter_sync_jobs (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_adapter_jobs_source ON adapter_sync_jobs (source_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_adapter_runs_source ON adapter_sync_runs (source_id, finished_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_context_snippets_ts ON context_snippets (ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_context_snippets_source_ts ON context_snippets (source, ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_context_snippets_unembedded ON context_snippets (embedded_at) WHERE embedded_at IS NULL`,

  // Gmail: по треду и по дате.
  `CREATE INDEX IF NOT EXISTS idx_gmail_messages_thread ON gmail_messages (thread_id, internal_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_gmail_messages_date ON gmail_messages (source_id, internal_date DESC)`,

  // AI Chat.
  `CREATE INDEX IF NOT EXISTS idx_chat_sessions_uid ON chat_sessions (uid, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages (session_id, created_at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON chat_attachments (message_id)`,
];
