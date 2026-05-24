// CRUD над adapter_sources — реестром подключённых источников.
//
// Сами имена таблиц/колонок — в lib/schema.ts. Здесь только SQL-обёртки, чтобы
// API-роуты и админка не дублировали запросы.

import { getDb, ensureSchema } from "../db";
import type { AdapterKind, AdapterSourceRow, SourceStatus } from "./types";

export async function listSources(): Promise<AdapterSourceRow[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute(`SELECT * FROM adapter_sources ORDER BY kind ASC, id ASC`);
  return res.rows as unknown as AdapterSourceRow[];
}

export async function getSource(id: string): Promise<AdapterSourceRow | null> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM adapter_sources WHERE id = ?`,
    args: [id],
  });
  return (res.rows[0] as unknown as AdapterSourceRow) ?? null;
}

// Источники, которым пора синкаться. Возвращает только idle (не в работе и не
// отключённые). NULL next_run_at трактуется как «никогда не запускался» = due.
export async function listDueSources(now: Date = new Date()): Promise<AdapterSourceRow[]> {
  await ensureSchema();
  const db = getDb();
  const nowIso = now.toISOString();
  const res = await db.execute({
    sql: `SELECT * FROM adapter_sources
          WHERE status = 'idle'
            AND (next_run_at IS NULL OR next_run_at <= ?)
          ORDER BY next_run_at ASC`,
    args: [nowIso],
  });
  return res.rows as unknown as AdapterSourceRow[];
}

export async function upsertSource(args: {
  id: string;
  kind: AdapterKind;
  displayName?: string | null;
  credentials?: unknown;
  intervalSec?: number;
}): Promise<AdapterSourceRow> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const credsJson = args.credentials === undefined ? null : JSON.stringify(args.credentials);

  // Идемпотентно: вставляем или обновляем редактируемые поля. cursor/статус не
  // трогаем — они принадлежат рантайму, не админу.
  await db.execute({
    sql: `INSERT INTO adapter_sources
            (id, kind, display_name, status, credentials, interval_sec, created_at, updated_at)
          VALUES (?, ?, ?, 'idle', ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            kind = excluded.kind,
            display_name = COALESCE(excluded.display_name, adapter_sources.display_name),
            credentials = COALESCE(excluded.credentials, adapter_sources.credentials),
            interval_sec = excluded.interval_sec,
            updated_at = excluded.updated_at`,
    args: [
      args.id,
      args.kind,
      args.displayName ?? null,
      credsJson,
      args.intervalSec ?? 600,
      now,
      now,
    ],
  });

  const row = await getSource(args.id);
  if (!row) throw new Error(`adapter_source ${args.id} not found after upsert`);
  return row;
}

export async function setSourceStatus(id: string, status: SourceStatus): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE adapter_sources SET status = ?, updated_at = ? WHERE id = ?`,
    args: [status, new Date().toISOString(), id],
  });
}

// Переписать credentials — для рантайма (адаптер обновил access_token после
// OAuth-рефреша). Не трогаем status/cursor/interval — это поля админа/планировщика.
export async function updateSourceCredentials(
  id: string,
  credentials: unknown,
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE adapter_sources SET credentials = ?, updated_at = ? WHERE id = ?`,
    args: [JSON.stringify(credentials), new Date().toISOString(), id],
  });
}

// Перепланируем следующий запуск: next_run_at = now + interval_sec.
// Вызывается воркером в конце успешного sync'а.
export async function scheduleNextRun(args: {
  id: string;
  cursor?: unknown;
  intervalSec?: number;
  now?: Date;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const now = args.now ?? new Date();
  const src = await getSource(args.id);
  const interval = args.intervalSec ?? src?.interval_sec ?? 600;
  const next = new Date(now.getTime() + interval * 1000);
  const setCursor = args.cursor !== undefined;
  const cursorJson = setCursor ? JSON.stringify(args.cursor) : null;

  if (setCursor) {
    await db.execute({
      sql: `UPDATE adapter_sources
            SET cursor = ?,
                last_run_at = ?,
                next_run_at = ?,
                status = 'idle',
                last_error = NULL,
                last_error_id = NULL,
                updated_at = ?
            WHERE id = ?`,
      args: [cursorJson, now.toISOString(), next.toISOString(), now.toISOString(), args.id],
    });
  } else {
    await db.execute({
      sql: `UPDATE adapter_sources
            SET last_run_at = ?,
                next_run_at = ?,
                status = 'idle',
                last_error = NULL,
                last_error_id = NULL,
                updated_at = ?
            WHERE id = ?`,
      args: [now.toISOString(), next.toISOString(), now.toISOString(), args.id],
    });
  }
}

export async function markSourceError(args: {
  id: string;
  message: string;
  errorId?: string | null;
  // На ошибке тоже сдвигаем next_run_at, чтобы не зацикливать tick. По умолчанию
  // — на тот же intervalSec; для быстрых ретраев можно передать меньшее число.
  retryAfterSec?: number;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const now = new Date();
  const src = await getSource(args.id);
  const retry = args.retryAfterSec ?? src?.interval_sec ?? 600;
  const next = new Date(now.getTime() + retry * 1000);

  await db.execute({
    sql: `UPDATE adapter_sources
          SET status = 'error',
              last_error = ?,
              last_error_id = ?,
              last_run_at = ?,
              next_run_at = ?,
              updated_at = ?
          WHERE id = ?`,
    args: [
      args.message.slice(0, 4000),
      args.errorId ?? null,
      now.toISOString(),
      next.toISOString(),
      now.toISOString(),
      args.id,
    ],
  });
}

// Парсинг JSON-полей с безопасным fallback'ом — credentials/cursor могут быть
// NULL или битыми. Не валим вызывающего, возвращаем null.
export function parseJsonField<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
