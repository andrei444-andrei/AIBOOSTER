// Web-клиент (чистый HTTP/fetch, без нативного пакета libsql). Подходит для
// удалённой Turso (libsql://) и безопасен для serverless/Vercel — нативные
// .node-бинарники не попадают в бандл функции.
import { createClient, type Client } from "@libsql/client/web";
import { TABLES, INDEXES } from "./schema";

// Клиент Turso (libSQL). Создаётся лениво, один на процесс.
let _client: Client | null = null;

export function getDb(): Client {
  if (_client) return _client;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error("TURSO_DATABASE_URL is not set");
  }

  _client = createClient({ url, authToken });
  return _client;
}

// Самопровижининг схемы: идемпотентно создаём все таблицы и индексы,
// затем добавляем недостающие колонки (мягкая миграция в стиле «таблица
// уже могла существовать с прошлой версии — дополним её»).
// Запускается один раз на процесс (промис кэшируется). Провал не должен
// валить приложение у вызывающего — оборачивай вызов в try/catch там, где
// это критично, но сам ensureSchema здесь не глотает ошибку, чтобы её было
// видно в логах при старте.
let _schemaReady: Promise<void> | null = null;

// Список добавлений колонок (мягкая миграция). SQLite позволяет
// ALTER TABLE ADD COLUMN с дефолтом, поэтому это безопасно.
interface ColumnAddition {
  table: string;
  column: string;
  ddl: string; // полное выражение после ADD COLUMN, включая имя и тип
}

const COLUMN_MIGRATIONS: ColumnAddition[] = [
  // mode оставлен для обратной совместимости — был частью v1 (Normal/Pro),
  // сейчас не используется, но в существующих БД остаётся.
  { table: "chat_sessions", column: "mode", ddl: "mode TEXT NOT NULL DEFAULT 'normal'" },
  { table: "chat_sessions", column: "model_override", ddl: "model_override TEXT" },
  { table: "chat_sessions", column: "category_override", ddl: "category_override TEXT" },
  { table: "chat_messages", column: "duration_ms", ddl: "duration_ms INTEGER" },
  { table: "chat_messages", column: "route_meta", ddl: "route_meta TEXT" },
];

async function hasColumn(table: string, column: string): Promise<boolean> {
  const db = getDb();
  const res = await db.execute(`PRAGMA table_info(${table})`);
  for (const row of res.rows as unknown as Array<{ name: string }>) {
    if (row.name === column) return true;
  }
  return false;
}

export function ensureSchema(): Promise<void> {
  if (_schemaReady) return _schemaReady;

  _schemaReady = (async () => {
    const db = getDb();
    for (const table of TABLES) {
      await db.execute(table.ddl);
    }
    for (const idx of INDEXES) {
      await db.execute(idx);
    }
    // Мягкая миграция: добавляем колонки, которых нет в существующих таблицах.
    for (const m of COLUMN_MIGRATIONS) {
      const exists = await hasColumn(m.table, m.column);
      if (!exists) {
        await db.execute(`ALTER TABLE ${m.table} ADD COLUMN ${m.ddl}`);
      }
    }
  })();

  // Если провижининг упал — сбрасываем кэш, чтобы следующая попытка повторила.
  _schemaReady.catch(() => {
    _schemaReady = null;
  });

  return _schemaReady;
}
