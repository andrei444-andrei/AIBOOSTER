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
  { table: "chat_settings", column: "last_chat_seen_at", ddl: "last_chat_seen_at TEXT" },
];

async function hasColumn(table: string, column: string): Promise<boolean> {
  const db = getDb();
  const res = await db.execute(`PRAGMA table_info(${table})`);
  for (const row of res.rows as unknown as Array<{ name: string }>) {
    if (row.name === column) return true;
  }
  return false;
}

/** Фиксированный UID владельца — продукт single-user.
 *  Должен совпадать с константой OWNER_UID в components/chat/ChatApp.tsx. */
export const OWNER_UID = "owner-andrei-2026";

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
    // Диагностический сигнал на случай подмены прод-БД (orphan-инстанс после
    // Vercel-Turso integration). Делаем ДО auto-claim миграции ниже, иначе
    // UPDATE перепишет orphan-сессии под OWNER_UID и стереть сигнал.
    await checkPossibleDbSwap(db);
    // Single-owner-миграция: все исторические chat-сессии собираем под
    // одним owner-UID. Раньше каждый браузер получал случайный uid и
    // история «терялась» при смене устройства. Идемпотентно: если уже
    // всё под OWNER_UID, UPDATE затрагивает 0 строк.
    await db
      .execute({
        sql: `UPDATE chat_sessions SET uid = ? WHERE uid != ?`,
        args: [OWNER_UID, OWNER_UID],
      })
      .catch(() => {
        // Не критично — таблица могла не существовать на старте.
      });
  })();

  // Если провижининг упал — сбрасываем кэш, чтобы следующая попытка повторила.
  _schemaReady.catch(() => {
    _schemaReady = null;
  });

  return _schemaReady;
}

// Страж подмены прод-БД (orphan после Vercel-Turso integration или
// случайной переключки TURSO_DATABASE_URL). Один раз на процесс. Если в
// chat_sessions нет ни одной строки под OWNER_UID, а chat_settings.last_chat_seen_at
// уже стоит и старше часа — это означает, что мы смотрим на чужой/устаревший
// инстанс, в котором сидит чьё-то старое состояние. Пишем error в app_errors
// напрямую (минуя logServerError, чтобы не уйти в рекурсию через ensureSchema)
// с тегом possible_db_swap, чтобы алёрт сразу всплыл на /admin.
let _swapCheckDone = false;

async function checkPossibleDbSwap(db: Client): Promise<void> {
  if (_swapCheckDone) return;
  _swapCheckDone = true;

  try {
    const sessions = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM chat_sessions WHERE uid = ?`,
      args: [OWNER_UID],
    });
    if (Number(sessions.rows[0]?.n ?? 0) > 0) return;

    const hasSeenCol = await hasColumn("chat_settings", "last_chat_seen_at");
    if (!hasSeenCol) return;

    const seen = await db.execute(
      `SELECT last_chat_seen_at FROM chat_settings WHERE id = 1`,
    );
    const lastSeenRaw = seen.rows[0]?.last_chat_seen_at;
    if (lastSeenRaw === undefined || lastSeenRaw === null) return;
    const lastSeen = new Date(String(lastSeenRaw));
    if (Number.isNaN(lastSeen.getTime())) return;

    const STALE_MS = 60 * 60 * 1000; // > 1 часа без апдейта при пустых sessions = подозрительно
    const ageMs = Date.now() - lastSeen.getTime();
    if (ageMs < STALE_MS) return;

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
        `possible_db_swap: chat_sessions пуста для OWNER_UID, но chat_settings.last_chat_seen_at = ${String(lastSeenRaw)} (~${Math.round(ageMs / 60000)} мин назад)`,
        null,
        process.env.BUILD_ID ?? null,
        null,
        JSON.stringify({
          tag: "possible_db_swap",
          owner_uid: OWNER_UID,
          last_chat_seen_at: String(lastSeenRaw),
          age_ms: ageMs,
        }),
      ],
    });
  } catch {
    // Не валим ensureSchema из-за диагностического сигнала.
  }
}
