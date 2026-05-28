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
  {
    name: "news_sources",
    description:
      "Источники новостей: каналы Telegram (через Apify) и RSS-ленты. Каждые fetch_interval_minutes cron-tick проверяет, не пора ли тянуть новый контент. locked_until — простой advisory-лок, чтобы overlapping ticks не дёргали один и тот же источник дважды. apify_run_id хранит активный async-run Apify: первый tick запускает run, следующий забирает результат — обходит таймаут serverless-функций.",
    ddl: `CREATE TABLE IF NOT EXISTS news_sources (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      url TEXT NOT NULL,
      name TEXT NOT NULL,
      fetch_interval_minutes INTEGER NOT NULL DEFAULT 30,
      last_fetched_at TEXT,
      locked_until TEXT,
      apify_run_id TEXT,
      apify_run_status TEXT,
      apify_run_started_at TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    columns: [
      { name: "id", description: "UUID источника." },
      { name: "kind", description: "Тип: 'telegram' | 'rss'." },
      { name: "url", description: "Для telegram — https://t.me/CHANNEL; для rss — URL ленты." },
      { name: "name", description: "Человеко-читаемое имя для UI." },
      { name: "fetch_interval_minutes", description: "Минимальный интервал между фетчами одного источника." },
      { name: "last_fetched_at", description: "ISO-время последнего успешного фетча (или null для нового источника)." },
      { name: "locked_until", description: "До этого времени другой cron-tick не должен брать источник. Освобождается после обработки или по таймауту." },
      { name: "apify_run_id", description: "ID активного Apify run для async-режима. Null = можно запускать новый." },
      { name: "apify_run_status", description: "Кешированный последний статус Apify run (READY/RUNNING/SUCCEEDED/FAILED) — для UI/отладки." },
      { name: "apify_run_started_at", description: "Когда был запущен текущий run. Защита от зависших runs." },
      { name: "active", description: "1/0 — активен ли источник." },
      { name: "created_at", description: "Когда добавлен." },
    ],
  },
  {
    name: "news_items",
    description:
      "Новостные посты: сырые данные с источника + результат валидации Sonnet. status='pending' → ещё не прошёл валидатор; 'validated' → есть verdict. UNIQUE(source_id, external_id) защищает от дублей при повторных фетчах. Полный input/output LLM хранится в validation_* колонках для отладочной панели и переоценки при смене промта.",
    ddl: `CREATE TABLE IF NOT EXISTS news_items (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      url TEXT,
      title TEXT,
      body TEXT,
      published_at TEXT,
      raw_meta TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      validation_input TEXT,
      validation_output_json TEXT,
      validation_error TEXT,
      model_used TEXT,
      summary TEXT,
      value_explanation TEXT,
      matched_topics_json TEXT,
      relevance INTEGER,
      verdict TEXT,
      reasoning TEXT,
      validated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (source_id, external_id)
    )`,
    columns: [
      { name: "id", description: "UUID поста." },
      { name: "source_id", description: "FK на news_sources.id." },
      { name: "external_id", description: "Идентификатор поста в источнике (Telegram message id или RSS guid). Уникален в рамках источника." },
      { name: "url", description: "Прямая ссылка на пост/статью." },
      { name: "title", description: "Заголовок. Для Telegram — первая строка/превью." },
      { name: "body", description: "Текст поста/статьи." },
      { name: "published_at", description: "ISO-время публикации в источнике." },
      { name: "raw_meta", description: "Сырой JSON от источника (для отладки и переразбора)." },
      { name: "status", description: "'pending' = ждёт валидатора; 'validated' = есть verdict; 'failed' = LLM не вернул валидный JSON." },
      { name: "validation_input", description: "Полный input-промт, отправленный валидатору (для отладочной панели)." },
      { name: "validation_output_json", description: "Сырой JSON-ответ от LLM (для отладки)." },
      { name: "validation_error", description: "Сообщение об ошибке валидации (если status='failed')." },
      { name: "model_used", description: "Имя модели (claude-sonnet-4-6 и т.п.)." },
      { name: "summary", description: "1-line summary от валидатора (для карточки в ленте)." },
      { name: "value_explanation", description: "Почему этот пост полезен пользователю (от валидатора, склейка actionable/worldview_fit/novelty)." },
      { name: "matched_topics_json", description: "JSON-массив имён тем, к которым валидатор отнёс пост." },
      { name: "relevance", description: "0..100 — оценка релевантности от валидатора." },
      { name: "verdict", description: "'show' | 'borderline' | 'skip'." },
      { name: "reasoning", description: "Обоснование verdict от валидатора (2-3 предложения)." },
      { name: "validated_at", description: "Когда прошёл валидатор." },
      { name: "created_at", description: "Когда вставлен (момент фетча)." },
    ],
  },
  {
    name: "news_feedback",
    description:
      "Сигналы пользователя по постам ленты: like/dislike/hide + опциональная chip-причина из заранее заданного списка. Используется для калибровки промта и (в будущем) для авто-предложений правок профиля.",
    ddl: `CREATE TABLE IF NOT EXISTS news_feedback (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      signal TEXT NOT NULL,
      reason_chip TEXT,
      custom_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    columns: [
      { name: "id", description: "UUID события." },
      { name: "item_id", description: "FK на news_items.id." },
      { name: "signal", description: "'like' | 'dislike' | 'hide'." },
      { name: "reason_chip", description: "Заранее заданный ярлык причины (например 'не моя тема', 'поверхностно')." },
      { name: "custom_text", description: "Произвольный комментарий пользователя." },
      { name: "created_at", description: "Время фидбека." },
    ],
  },
  {
    name: "interest_profile",
    description:
      "Профиль интересов пользователя для валидатора новостей. Single-user MVP: одна строка с id='me'. worldview_context — свободный текст 'кто я, что строю, цели', topics_json — массив тем с описаниями. Сидится дефолтным профилем при первом cron-tick, дальше редактируется через /news/profile.",
    ddl: `CREATE TABLE IF NOT EXISTS interest_profile (
      id TEXT PRIMARY KEY,
      worldview_context TEXT NOT NULL DEFAULT '',
      topics_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    columns: [
      { name: "id", description: "Идентификатор профиля. Для MVP всегда 'me'." },
      { name: "worldview_context", description: "Свободный текст 1-2 абзаца: 'кто я, что строю, какие цели на 3-6 мес'. Кладётся в system-промт валидатора." },
      { name: "topics_json", description: "JSON-массив тем: [{name, description, what_bores_me, priority: 'low'|'medium'|'high', status: 'active'|'muted'}]." },
      { name: "updated_at", description: "Когда профиль последний раз правился." },
    ],
  },
];

// Индексы.
export const INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_app_errors_ts ON app_errors (ts DESC)`,
  // Кеш: быстрый поиск готовой job'ы по (видео, язык, качество).
  `CREATE INDEX IF NOT EXISTS idx_vtj_cache ON video_translation_jobs (yt_video_id, target_lang, quality, status)`,
  // Очередь: воркер берёт queued по created_at.
  `CREATE INDEX IF NOT EXISTS idx_vtj_queue ON video_translation_jobs (status, created_at)`,
  // Подгрузка сегментов по job'е по порядку.
  `CREATE INDEX IF NOT EXISTS idx_vts_job ON video_translation_segments (job_id, idx)`,
  // News: лента сортируется по validated_at DESC по verdict.
  `CREATE INDEX IF NOT EXISTS idx_news_items_verdict ON news_items (verdict, validated_at DESC)`,
  // News: очередь pending для валидации.
  `CREATE INDEX IF NOT EXISTS idx_news_items_pending ON news_items (status, created_at)`,
  // News: cron-tick ищет due-источники по last_fetched_at.
  `CREATE INDEX IF NOT EXISTS idx_news_sources_due ON news_sources (active, last_fetched_at)`,
  // News: feedback по item для агрегации.
  `CREATE INDEX IF NOT EXISTS idx_news_feedback_item ON news_feedback (item_id, created_at DESC)`,
];
