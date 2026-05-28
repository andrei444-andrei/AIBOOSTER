// CRUD-операции над video_translation_jobs и video_translation_segments.
//
// Конкретные SQL-запросы держим здесь, чтобы API-роуты были компактные и не
// дублировали имена колонок. Имена самих таблиц/колонок — в schema.ts.

import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "./db";
import { canonicalUrl, type Quality } from "./youtube";

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";
export type JobStage = "download" | "asr" | "translate" | "tts" | "mux";

export type WatchStatus = "to_watch" | "watched";
export type JobSource = "manual" | "playlist";

export interface JobRow {
  id: string;
  yt_url: string;
  yt_video_id: string;
  yt_title: string | null;
  yt_duration_sec: number | null;
  source_lang: string | null;
  target_lang: string;
  quality: string;
  status: JobStatus;
  stage: JobStage | null;
  progress: number;
  error_message: string | null;
  error_id: string | null;
  audio_url: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  watch_status: WatchStatus;
  last_position_sec: number;
  watched_at: string | null;
  source: JobSource;
  summary: string | null;
  chapters: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface SegmentRow {
  job_id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  source_text: string | null;
  translated_text: string | null;
}

// Ищем готовую кешированную job для пары (video_id, target_lang, quality).
// Если есть status='done' с непустым audio_url — возвращаем её.
export async function findCachedJob(
  videoId: string,
  targetLang: string,
  quality: Quality,
): Promise<JobRow | null> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM video_translation_jobs
          WHERE yt_video_id = ? AND target_lang = ? AND quality = ?
            AND status = 'done' AND audio_url IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1`,
    args: [videoId, targetLang, quality],
  });
  return (res.rows[0] as unknown as JobRow) ?? null;
}

export async function createJob(args: {
  videoId: string;
  url?: string;
  targetLang: string;
  quality: Quality;
  source?: JobSource;
}): Promise<JobRow> {
  await ensureSchema();
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const url = args.url ?? canonicalUrl(args.videoId);
  const source = args.source ?? "manual";

  await db.execute({
    sql: `INSERT INTO video_translation_jobs
            (id, yt_url, yt_video_id, target_lang, quality, status, progress, source, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)`,
    args: [id, url, args.videoId, args.targetLang, args.quality, source, now, now],
  });

  const row = await getJob(id);
  if (!row) throw new Error("job not found after insert");
  return row;
}

// Есть ли уже какая-нибудь job для (video_id, target_lang)? Используется
// плейлист-поллером, чтобы не плодить дубли при каждом тике cron.
export async function hasJobForVideo(
  videoId: string,
  targetLang: string,
): Promise<boolean> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT 1 FROM video_translation_jobs
          WHERE yt_video_id = ? AND target_lang = ?
          LIMIT 1`,
    args: [videoId, targetLang],
  });
  return res.rows.length > 0;
}

export async function getJob(id: string): Promise<JobRow | null> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM video_translation_jobs WHERE id = ?`,
    args: [id],
  });
  return (res.rows[0] as unknown as JobRow) ?? null;
}

// Список недавних job'ов для боковой панели истории и страницы-библиотеки.
// Возвращаем только поля, нужные для рендера карточки.
export interface JobSummary {
  id: string;
  yt_video_id: string;
  yt_title: string | null;
  yt_duration_sec: number | null;
  target_lang: string;
  status: JobStatus;
  stage: JobStage | null;
  progress: number;
  audio_url: string | null;
  watch_status: WatchStatus;
  last_position_sec: number;
  source: JobSource;
  summary: string | null;
  created_at: string;
}

export async function listRecentJobs(args: {
  limit?: number;
  watchStatus?: WatchStatus | "all";
} = {}): Promise<JobSummary[]> {
  await ensureSchema();
  const db = getDb();
  const limit = Math.max(1, Math.min(200, args.limit ?? 60));
  const wantWatch = args.watchStatus ?? "all";

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (wantWatch !== "all") {
    where.push("watch_status = ?");
    params.push(wantWatch);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  params.push(limit);

  const res = await db.execute({
    sql: `SELECT id, yt_video_id, yt_title, yt_duration_sec, target_lang,
                 status, stage, progress, audio_url,
                 watch_status, last_position_sec, source, summary, created_at
          FROM video_translation_jobs
          ${whereSql}
          ORDER BY created_at DESC
          LIMIT ?`,
    args: params,
  });
  return res.rows as unknown as JobSummary[];
}

// Сохраняет summary + chapters после того как LLM сгенерил их в пайплайне.
// chapters пишутся как JSON-строка — UI распарсит обратно.
export async function saveJobMeta(args: {
  id: string;
  summary: string;
  chapters: Array<{ start_sec: number; title: string }>;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE video_translation_jobs
          SET summary = ?, chapters = ?, updated_at = ?
          WHERE id = ?`,
    args: [
      args.summary || null,
      args.chapters.length > 0 ? JSON.stringify(args.chapters) : null,
      new Date().toISOString(),
      args.id,
    ],
  });
}

// Обновляет позицию воспроизведения. Принимает позицию в секундах. Опционально
// помечает как «watched» — клиент шлёт это на onEnded или ручным кликом.
export async function updateJobPlayback(args: {
  id: string;
  positionSec?: number;
  watchStatus?: WatchStatus;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const sets: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [new Date().toISOString()];

  if (args.positionSec !== undefined) {
    sets.push("last_position_sec = ?");
    params.push(Math.max(0, args.positionSec));
  }
  if (args.watchStatus !== undefined) {
    sets.push("watch_status = ?");
    params.push(args.watchStatus);
    if (args.watchStatus === "watched") {
      sets.push("watched_at = ?");
      params.push(new Date().toISOString());
    } else {
      sets.push("watched_at = NULL");
    }
  }

  params.push(args.id);
  await db.execute({
    sql: `UPDATE video_translation_jobs SET ${sets.join(", ")} WHERE id = ?`,
    args: params,
  });
}

export async function getSegments(jobId: string): Promise<SegmentRow[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT job_id, idx, start_ms, end_ms, source_text, translated_text
          FROM video_translation_segments
          WHERE job_id = ?
          ORDER BY idx ASC`,
    args: [jobId],
  });
  return res.rows as unknown as SegmentRow[];
}

// Атомарно забирает одну queued-job воркеру.
// Возвращает null, если очередь пустая.
export async function claimNextJob(workerId: string): Promise<JobRow | null> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();

  // libSQL/SQLite не поддерживает SELECT ... FOR UPDATE. Используем
  // UPDATE ... WHERE status='queued' AND id = (SELECT ... LIMIT 1)
  // в одном запросе — это атомарно для одного соединения.
  // Дополнительно учитываем "зависшие": claimed_at старше 30 минут —
  // считаем job брошенной и подбираем повторно.
  const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const pickRes = await db.execute({
    sql: `SELECT id FROM video_translation_jobs
          WHERE status = 'queued'
             OR (status = 'running' AND claimed_at < ?)
          ORDER BY created_at ASC
          LIMIT 1`,
    args: [staleCutoff],
  });
  const pick = pickRes.rows[0]?.id as string | undefined;
  if (!pick) return null;

  const upd = await db.execute({
    sql: `UPDATE video_translation_jobs
          SET status = 'running',
              stage = 'download',
              claimed_at = ?,
              claimed_by = ?,
              updated_at = ?,
              error_message = NULL
          WHERE id = ?
            AND (status = 'queued' OR (status = 'running' AND claimed_at < ?))`,
      args: [now, workerId, now, pick, staleCutoff],
  });
  if (upd.rowsAffected === 0) {
    // Кто-то опередил, попробуем ещё раз с другой записью.
    return claimNextJob(workerId);
  }
  return getJob(pick);
}

export async function updateJobProgress(args: {
  id: string;
  stage?: JobStage;
  progress?: number;
  title?: string | null;
  durationSec?: number | null;
  sourceLang?: string | null;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const sets: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [new Date().toISOString()];

  if (args.stage !== undefined) {
    sets.push("stage = ?");
    params.push(args.stage);
  }
  if (args.progress !== undefined) {
    sets.push("progress = ?");
    params.push(Math.max(0, Math.min(100, Math.round(args.progress))));
  }
  if (args.title !== undefined) {
    sets.push("yt_title = ?");
    params.push(args.title);
  }
  if (args.durationSec !== undefined) {
    sets.push("yt_duration_sec = ?");
    params.push(args.durationSec);
  }
  if (args.sourceLang !== undefined) {
    sets.push("source_lang = ?");
    params.push(args.sourceLang);
  }

  params.push(args.id);

  await db.execute({
    sql: `UPDATE video_translation_jobs SET ${sets.join(", ")} WHERE id = ?`,
    args: params,
  });
}

export async function markJobDone(args: {
  id: string;
  audioUrl: string;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE video_translation_jobs
          SET status = 'done',
              stage = NULL,
              progress = 100,
              audio_url = ?,
              updated_at = ?,
              finished_at = ?,
              error_message = NULL
          WHERE id = ?`,
    args: [args.audioUrl, now, now, args.id],
  });
}

export async function markJobError(args: {
  id: string;
  message: string;
  errorId?: string | null;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE video_translation_jobs
          SET status = 'error',
              error_message = ?,
              error_id = ?,
              updated_at = ?,
              finished_at = ?
          WHERE id = ?`,
    args: [args.message.slice(0, 4000), args.errorId ?? null, now, now, args.id],
  });
}

// Перезаписывает все сегменты job'а одним пакетом. Используется воркером
// после ASR (только source_text) и после перевода (с translated_text).
export async function replaceSegments(
  jobId: string,
  segments: Array<{
    idx: number;
    start_ms: number;
    end_ms: number;
    source_text?: string | null;
    translated_text?: string | null;
  }>,
): Promise<void> {
  await ensureSchema();
  const db = getDb();

  // libSQL поддерживает batch — пишем удаление + вставки одной транзакцией.
  const statements = [
    { sql: `DELETE FROM video_translation_segments WHERE job_id = ?`, args: [jobId] },
    ...segments.map((s) => ({
      sql: `INSERT INTO video_translation_segments
              (job_id, idx, start_ms, end_ms, source_text, translated_text)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        jobId,
        s.idx,
        s.start_ms,
        s.end_ms,
        s.source_text ?? null,
        s.translated_text ?? null,
      ],
    })),
  ];
  await db.batch(statements, "write");
}
