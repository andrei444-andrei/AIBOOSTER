// Web-клиент (чистый HTTP/fetch, без нативного пакета libsql). Подходит для
// удалённой Turso (libsql://) и безопасен для serverless/Vercel — нативные
// .node-бинарники не попадают в бандл функции.
import { randomUUID } from "node:crypto";
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
    // Диагностический сигнал на случай подмены прод-БД (orphan-инстанс после
    // Vercel-Turso integration). Намеренно не падает наружу: это страховка,
    // а не часть основной логики.
    await checkPossibleDbSwap(db);
  })();

  // Если провижининг упал — сбрасываем кэш, чтобы следующая попытка повторила.
  _schemaReady.catch(() => {
    _schemaReady = null;
  });

  return _schemaReady;
}

// Один раз на процесс. Идея: если приложение подключилось к подменённой/пустой
// БД (например, к orphan-инстансу после удаления Vercel-Turso integration),
// то для известного владельца не будет ни одной chat_sessions, но в
// app_settings уцелеет старая метка last_chat_seen_at — это и есть сигнал.
//
// Пока в проекте нет ни chat_sessions, ни app_settings — проверка просто
// тихо выходит. Как только AI-чат добавит эти таблицы, страж включится
// автоматически.
let _swapCheckDone = false;

async function checkPossibleDbSwap(db: Client): Promise<void> {
  if (_swapCheckDone) return;
  _swapCheckDone = true;

  const ownerUid = process.env.OWNER_UID;
  if (!ownerUid) return;

  try {
    const present = await db.execute(
      `SELECT name FROM sqlite_master
       WHERE type='table' AND name IN ('chat_sessions','app_settings')`,
    );
    const names = new Set(present.rows.map((r) => String(r.name)));
    if (!names.has("chat_sessions") || !names.has("app_settings")) return;

    const sessions = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM chat_sessions WHERE owner_uid = ?`,
      args: [ownerUid],
    });
    if (Number(sessions.rows[0]?.n ?? 0) > 0) return;

    const seen = await db.execute(
      `SELECT value FROM app_settings WHERE key = 'last_chat_seen_at' LIMIT 1`,
    );
    const lastSeenRaw = seen.rows[0]?.value;
    if (lastSeenRaw === undefined || lastSeenRaw === null) return;
    const lastSeen = new Date(String(lastSeenRaw));
    if (Number.isNaN(lastSeen.getTime())) return;

    const STALE_MS = 60 * 60 * 1000; // > 1 часа без апдейта при пустых sessions = подозрительно
    const ageMs = Date.now() - lastSeen.getTime();
    if (ageMs < STALE_MS) return;

    // Пишем прямо в app_errors, минуя logError, чтобы не уйти в рекурсию
    // через ensureSchema → logError → ensureSchema.
    await db.execute({
      sql: `INSERT INTO app_errors
              (id, ts, level, source, route, message, stack, build, user_agent, meta)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        randomUUID(),
        new Date().toISOString(),
        "error",
        "server",
        "ensureSchema",
        `possible_db_swap: chat_sessions пуста для OWNER_UID, но app_settings.last_chat_seen_at = ${String(lastSeenRaw)} (~${Math.round(ageMs / 60000)} мин назад)`,
        null,
        process.env.BUILD_ID ?? null,
        null,
        JSON.stringify({
          tag: "possible_db_swap",
          owner_uid: ownerUid,
          last_chat_seen_at: String(lastSeenRaw),
          age_ms: ageMs,
        }),
      ],
    });
  } catch {
    // Не валим ensureSchema из-за диагностического сигнала.
  }
}
