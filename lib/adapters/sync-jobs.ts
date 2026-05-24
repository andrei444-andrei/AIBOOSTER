// Очередь sync-job'ов адаптеров. Аналог lib/jobs.ts, но для adapter_sync_jobs.
//
// Поток:
//   tick → enqueueJob() (по одному на due-источник, с дедупом)
//   worker → claimNextSyncJob() → adapter.sync() → updateSyncJob() / finishSyncJob()

import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "../db";
import type {
  AdapterKind,
  AdapterSyncJobRow,
  JobKind,
  JobStatus,
} from "./types";

const STALE_AFTER_MS = 30 * 60 * 1000;

export async function getSyncJob(id: string): Promise<AdapterSyncJobRow | null> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM adapter_sync_jobs WHERE id = ?`,
    args: [id],
  });
  return (res.rows[0] as unknown as AdapterSyncJobRow) ?? null;
}

// Ставит job в очередь, если для этого источника уже нет активного job'а того
// же job_kind. Возвращает либо новый job, либо уже существующий активный.
// Это и есть «дедупликация» в tick'е.
export async function enqueueJob(args: {
  sourceId: string;
  kind: AdapterKind;
  jobKind?: JobKind;
}): Promise<AdapterSyncJobRow> {
  await ensureSchema();
  const db = getDb();
  const jobKind: JobKind = args.jobKind ?? "pull";

  const existing = await db.execute({
    sql: `SELECT * FROM adapter_sync_jobs
          WHERE source_id = ? AND job_kind = ? AND status IN ('queued', 'running')
          ORDER BY created_at DESC
          LIMIT 1`,
    args: [args.sourceId, jobKind],
  });
  if (existing.rows[0]) return existing.rows[0] as unknown as AdapterSyncJobRow;

  const id = randomUUID();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO adapter_sync_jobs
            (id, source_id, kind, job_kind, status, progress, fetched_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'queued', 0, 0, ?, ?)`,
    args: [id, args.sourceId, args.kind, jobKind, now, now],
  });

  const row = await getSyncJob(id);
  if (!row) throw new Error("adapter_sync_job not found after insert");
  return row;
}

// Атомарно забирает один queued-job. Если такого нет — null.
// Дополнительно подбирает зависшие running-job'ы (claimed_at старше STALE_AFTER_MS).
export async function claimNextSyncJob(workerId: string): Promise<AdapterSyncJobRow | null> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  const pickRes = await db.execute({
    sql: `SELECT id FROM adapter_sync_jobs
          WHERE status = 'queued'
             OR (status = 'running' AND claimed_at < ?)
          ORDER BY created_at ASC
          LIMIT 1`,
    args: [staleCutoff],
  });
  const pick = pickRes.rows[0]?.id as string | undefined;
  if (!pick) return null;

  const upd = await db.execute({
    sql: `UPDATE adapter_sync_jobs
          SET status = 'running',
              claimed_at = ?,
              claimed_by = ?,
              updated_at = ?,
              error_message = NULL
          WHERE id = ?
            AND (status = 'queued' OR (status = 'running' AND claimed_at < ?))`,
    args: [now, workerId, now, pick, staleCutoff],
  });
  if (upd.rowsAffected === 0) {
    // Кто-то опередил — пробуем следующий.
    return claimNextSyncJob(workerId);
  }
  return getSyncJob(pick);
}

export async function updateSyncJob(args: {
  id: string;
  progress?: number;
  fetchedCount?: number;
  stats?: Record<string, unknown>;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const sets: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [new Date().toISOString()];

  if (args.progress !== undefined) {
    sets.push("progress = ?");
    params.push(Math.max(0, Math.min(100, Math.round(args.progress))));
  }
  if (args.fetchedCount !== undefined) {
    sets.push("fetched_count = ?");
    params.push(args.fetchedCount);
  }
  if (args.stats !== undefined) {
    sets.push("stats = ?");
    params.push(JSON.stringify(args.stats));
  }

  params.push(args.id);
  await db.execute({
    sql: `UPDATE adapter_sync_jobs SET ${sets.join(", ")} WHERE id = ?`,
    args: params,
  });
}

// Финальное состояние job'а + одновременная запись в журнал adapter_sync_runs.
// Сам job оставляем (не удаляем) — удобно для отладки последнего падения;
// чистка старых job'ов — отдельной операцией позже.
export async function finishSyncJob(args: {
  id: string;
  status: Extract<JobStatus, "done" | "error" | "cancelled">;
  fetchedCount?: number;
  errorMessage?: string | null;
  errorId?: string | null;
  stats?: Record<string, unknown>;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const job = await getSyncJob(args.id);
  if (!job) return;

  const now = new Date();
  const nowIso = now.toISOString();
  const fetched = args.fetchedCount ?? job.fetched_count;
  const startedAt = job.claimed_at ?? job.created_at;
  const durationMs = Math.max(
    0,
    now.getTime() - new Date(startedAt).getTime(),
  );

  const statements = [
    {
      sql: `UPDATE adapter_sync_jobs
            SET status = ?,
                fetched_count = ?,
                stats = COALESCE(?, stats),
                error_message = ?,
                error_id = ?,
                updated_at = ?,
                finished_at = ?
            WHERE id = ?`,
      args: [
        args.status,
        fetched,
        args.stats ? JSON.stringify(args.stats) : null,
        args.errorMessage ?? null,
        args.errorId ?? null,
        nowIso,
        nowIso,
        args.id,
      ],
    },
    {
      sql: `INSERT INTO adapter_sync_runs
              (id, source_id, kind, job_kind, job_id, started_at, finished_at,
               duration_ms, fetched_count, status, error_message, error_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        randomUUID(),
        job.source_id,
        job.kind,
        job.job_kind,
        job.id,
        startedAt,
        nowIso,
        durationMs,
        fetched,
        args.status,
        args.errorMessage ?? null,
        args.errorId ?? null,
      ],
    },
  ];
  await db.batch(statements, "write");
}
