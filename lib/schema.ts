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
];
