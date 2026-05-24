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

  // ────────────────────────────────────────────────────────────────────
  // Модуль AI Chat
  // ────────────────────────────────────────────────────────────────────
  {
    name: "chat_sessions",
    description:
      "Сессия (один чат). Группируется по uid пользователя (анонимный, из localStorage). Хранит режим, явно выбранную пользователем модель (override) и заголовок.",
    ddl: `CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Новый чат',
      model TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'normal',
      model_override TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    columns: [
      { name: "id", description: "UUID сессии." },
      { name: "uid", description: "Анонимный идентификатор владельца (chat_uid из localStorage)." },
      { name: "title", description: "Заголовок чата (первая строка первого сообщения или ручная)." },
      { name: "model", description: "Последняя фактически использованная модель в сессии (для дисплея в сайдбаре)." },
      { name: "mode", description: "Режим работы: normal | pro. Влияет на выбор моделей и reasoning_effort." },
      { name: "model_override", description: "NULL = авто-роутинг. Иначе — модель, выбранная пользователем явно (стикает в рамках чата до сброса)." },
      { name: "created_at", description: "Когда создана." },
      { name: "updated_at", description: "Когда было последнее сообщение." },
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
      { name: "route_meta", description: "JSON с решением роутера: category, complexity, source, reasoning_effort, mode." },
      { name: "created_at", description: "Когда отправлено." },
    ],
  },
  {
    name: "chat_attachments",
    description:
      "Файлы, прикреплённые к сообщениям пользователя. Текст хранится в content_text, изображения — в content_base64 (без data: префикса).",
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
      { name: "enabled_blocks", description: "JSON: какие типы markdown-блоков разрешены (headings, tables, code, lists, quotes, hr, images, links, emphasis)." },
      { name: "created_at", description: "Когда строка появилась." },
      { name: "updated_at", description: "Когда была последняя правка." },
    ],
  },
];

// Индексы для быстрых выборок.
export const INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_app_errors_ts ON app_errors (ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_sessions_uid ON chat_sessions (uid, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages (session_id, created_at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON chat_attachments (message_id)`,
];
