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
];

// Индексы для быстрого чтения.
export const INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_app_errors_ts ON app_errors (ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_scraper_runs_created ON scraper_runs (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_scraper_attempts_run ON scraper_attempts (run_id, n)`,
];
