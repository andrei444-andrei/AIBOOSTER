import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "./db";

export type ErrorLevel = "error" | "warn" | "info";
export type ErrorSource = "server" | "client";

export interface LogInput {
  level?: ErrorLevel;
  source: ErrorSource;
  route?: string | null;
  message: string;
  stack?: string | null;
  build?: string | null;
  userAgent?: string | null;
  meta?: unknown;
}

export interface AppErrorRow {
  id: string;
  ts: string;
  level: string;
  source: string;
  route: string | null;
  message: string;
  stack: string | null;
  build: string | null;
  user_agent: string | null;
  meta: string | null;
}

// Пишет ошибку в единую таблицу app_errors и возвращает её id (error_id).
// Мягкий сбой: если запись не удалась (нет БД, read-only токен и т.п.) —
// логируем в консоль и не роняем вызывающий код. Возвращаем id в любом случае,
// чтобы его можно было показать пользователю.
export async function logError(input: LogInput): Promise<string> {
  const id = randomUUID();
  const build = input.build ?? process.env.BUILD_ID ?? null;
  const meta =
    input.meta === undefined || input.meta === null
      ? null
      : typeof input.meta === "string"
        ? input.meta
        : safeStringify(input.meta);

  // ts задаём явно (ISO, UTC). Не полагаемся на DB-default: таблица app_errors
  // может быть общей/созданной другим проектом без DEFAULT для ts. Единый ISO
  // формат также обеспечивает корректную сортировку по ts.
  const ts = new Date().toISOString();

  try {
    await ensureSchema();
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO app_errors
              (id, ts, level, source, route, message, stack, build, user_agent, meta)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        ts,
        input.level ?? "error",
        input.source,
        input.route ?? null,
        input.message,
        input.stack ?? null,
        build,
        input.userAgent ?? null,
        meta,
      ],
    });
  } catch (err) {
    // Не маскируем: дублируем в консоль, чтобы хотя бы в рантайм-логах осталось.
    console.error("[logError] failed to persist error", {
      error_id: id,
      original: input.message,
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  return id;
}

// Удобная обёртка для серверных исключений.
export async function logServerError(
  err: unknown,
  route?: string,
  meta?: unknown,
): Promise<string> {
  const e = err instanceof Error ? err : new Error(String(err));
  return logError({
    level: "error",
    source: "server",
    route,
    message: e.message,
    stack: e.stack ?? null,
    meta,
  });
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
