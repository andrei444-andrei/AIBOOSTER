// Нормализованный слой context_snippets — единый интерфейс для агентов.
//
// Каждый адаптер для каждой сущности (письмо/страница/сообщение/событие)
// вызывает upsertSnippet(). Ключ дедупликации — (source, source_ref).
//
// Эмбеддинги тут не считаются — их пишет отдельный embed-job (фаза 2).

import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "../db";
import type { AdapterKind } from "./types";

export interface SnippetInput {
  source: AdapterKind;
  sourceRef: string;
  ts: string;       // ISO UTC
  title?: string | null;
  body: string;
  meta?: unknown;   // структурированные подсказки (from/url/labels/...)
}

export interface SnippetRow {
  id: string;
  source: string;
  source_ref: string;
  ts: string;
  title: string | null;
  body: string;
  meta: string | null;
  embedding: Uint8Array | null;
  embedding_model: string | null;
  embedded_at: string | null;
  fetched_at: string;
  updated_at: string;
}

// Идемпотентный апсёрт по (source, source_ref). Если контент сниппета не
// поменялся, embedding не инвалидируем (важно: не хотим тратить токены на
// повторный embed одного и того же).
export async function upsertSnippet(input: SnippetInput): Promise<{ id: string; changed: boolean }> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const metaJson = input.meta === undefined ? null : JSON.stringify(input.meta);

  // Сначала смотрим, есть ли уже строка — чтобы понять, поменялось ли тело
  // (и нужно ли сбрасывать embedding).
  const existing = await db.execute({
    sql: `SELECT id, body, title, meta FROM context_snippets WHERE source = ? AND source_ref = ?`,
    args: [input.source, input.sourceRef],
  });

  if (existing.rows[0]) {
    const row = existing.rows[0] as Record<string, unknown>;
    const id = String(row.id);
    const bodyChanged = row.body !== input.body;
    const titleChanged = (row.title ?? null) !== (input.title ?? null);
    const metaChanged = (row.meta ?? null) !== metaJson;
    const changed = bodyChanged || titleChanged || metaChanged;
    if (!changed) {
      return { id, changed: false };
    }
    await db.execute({
      sql: `UPDATE context_snippets
            SET ts = ?, title = ?, body = ?, meta = ?,
                ${bodyChanged ? "embedding = NULL, embedding_model = NULL, embedded_at = NULL," : ""}
                updated_at = ?
            WHERE id = ?`,
      args: [input.ts, input.title ?? null, input.body, metaJson, now, id],
    });
    return { id, changed: true };
  }

  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO context_snippets
            (id, source, source_ref, ts, title, body, meta, fetched_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.source,
      input.sourceRef,
      input.ts,
      input.title ?? null,
      input.body,
      metaJson,
      now,
      now,
    ],
  });
  return { id, changed: true };
}

// Выборка последних сниппетов для агентов. Опционально фильтр по источникам
// и/или с конкретного момента (since). Сортировка по ts DESC.
export async function listRecentSnippets(args: {
  sources?: AdapterKind[];
  since?: string;
  limit?: number;
}): Promise<SnippetRow[]> {
  await ensureSchema();
  const db = getDb();
  const limit = Math.max(1, Math.min(1000, args.limit ?? 100));
  const conds: string[] = [];
  const params: (string | number)[] = [];

  if (args.sources && args.sources.length > 0) {
    const placeholders = args.sources.map(() => "?").join(", ");
    conds.push(`source IN (${placeholders})`);
    params.push(...args.sources);
  }
  if (args.since) {
    conds.push(`ts >= ?`);
    params.push(args.since);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const res = await db.execute({
    sql: `SELECT id, source, source_ref, ts, title, body, meta,
                 embedding_model, embedded_at, fetched_at, updated_at
          FROM context_snippets
          ${where}
          ORDER BY ts DESC
          LIMIT ?`,
    args: [...params, limit],
  });
  return res.rows as unknown as SnippetRow[];
}

// Сниппеты, у которых ещё нет embedding'а — для embed-job'а.
export async function listUnembeddedSnippets(limit = 50): Promise<SnippetRow[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT id, source, source_ref, ts, title, body, meta
          FROM context_snippets
          WHERE embedded_at IS NULL
          ORDER BY fetched_at ASC
          LIMIT ?`,
    args: [Math.max(1, Math.min(500, limit))],
  });
  return res.rows as unknown as SnippetRow[];
}

// Запись посчитанного эмбеддинга (вызывается embed-job'ом). Вектор сериализуем
// как float32 little-endian BLOB.
export async function saveEmbedding(args: {
  id: string;
  vector: number[];
  model: string;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const blob = new Uint8Array(new Float32Array(args.vector).buffer);
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE context_snippets
          SET embedding = ?, embedding_model = ?, embedded_at = ?
          WHERE id = ?`,
    args: [blob, args.model, now, args.id],
  });
}
