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
];

// Индексы для быстрого чтения.
export const INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_app_errors_ts ON app_errors (ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_scraper_runs_created ON scraper_runs (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_scraper_attempts_run ON scraper_attempts (run_id, n)`,
  `CREATE INDEX IF NOT EXISTS idx_scraper_catalog_category ON scraper_catalog (category_ru, stats_users DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_scraper_catalog_users ON scraper_catalog (stats_users DESC)`,
];
