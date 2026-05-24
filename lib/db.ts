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

// Самопровижининг схемы: идемпотентно создаём все таблицы и индексы.
// Запускается один раз на процесс (промис кэшируется). Провал не должен
// валить приложение у вызывающего — оборачивай вызов в try/catch там, где
// это критично, но сам ensureSchema здесь не глотает ошибку, чтобы её было
// видно в логах при старте.
let _schemaReady: Promise<void> | null = null;

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
  })();

  // Если провижининг упал — сбрасываем кэш, чтобы следующая попытка повторила.
  _schemaReady.catch(() => {
    _schemaReady = null;
  });

  return _schemaReady;
}
