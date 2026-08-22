// CRUD над english_dialogue_jobs и english_dialogue_segments.
//
// Зеркалит lib/jobs.ts (модуль youtube-translate): job создаётся в статусе
// queued, воркер атомарно его забирает (claimNext), гоняет пайплайн и
// помечает done/error. Плеер сохраняет позицию и watch_status.
//
// Имена таблиц/колонок — в schema.ts. Здесь только запросы.

import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "./db";

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";
export type JobStage = "script" | "tts" | "mux";
export type DialogueKind = "dialogue" | "monologue";
export type WatchStatus = "to_watch" | "watched";

export interface DialogueJobRow {
  id: string;
  topic: string;
  duration_min: number;
  kind: DialogueKind;
  with_translation: number; // 0 | 1
  speed: number;
  title: string | null;
  status: JobStatus;
  stage: JobStage | null;
  progress: number;
  error_message: string | null;
  error_id: string | null;
  audio_url: string | null;
  duration_sec: number | null;
  claimed_at: string | null;
  claimed_by: string | null;
  watch_status: WatchStatus;
  last_position_sec: number;
  watched_at: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface DialogueSegmentRow {
  job_id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  speaker: string | null;
  en_text: string;
  ru_text: string | null;
}

export interface CreateDialogueArgs {
  topic: string;
  durationMin: number;
  kind: DialogueKind;
  withTranslation: boolean;
  speed: number;
}

export async function createDialogueJob(
  args: CreateDialogueArgs,
): Promise<DialogueJobRow> {
  await ensureSchema();
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO english_dialogue_jobs
            (id, topic, duration_min, kind, with_translation, speed, status, progress, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
    args: [
      id,
      args.topic,
      args.durationMin,
      args.kind,
      args.withTranslation ? 1 : 0,
      args.speed,
      now,
      now,
    ],
  });

  const row = await getDialogueJob(id);
  if (!row) throw new Error("dialogue job not found after insert");
  return row;
}

export async function getDialogueJob(id: string): Promise<DialogueJobRow | null> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM english_dialogue_jobs WHERE id = ?`,
    args: [id],
  });
  return (res.rows[0] as unknown as DialogueJobRow) ?? null;
}

// Список для библиотеки. Возвращаем только поля карточки.
export interface DialogueJobSummary {
  id: string;
  topic: string;
  title: string | null;
  kind: DialogueKind;
  duration_min: number;
  with_translation: number;
  speed: number;
  status: JobStatus;
  stage: JobStage | null;
  progress: number;
  audio_url: string | null;
  duration_sec: number | null;
  watch_status: WatchStatus;
  last_position_sec: number;
  created_at: string;
}

export async function listDialogueJobs(
  args: { limit?: number; watchStatus?: WatchStatus | "all" } = {},
): Promise<DialogueJobSummary[]> {
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
    sql: `SELECT id, topic, title, kind, duration_min, with_translation, speed,
                 status, stage, progress, audio_url, duration_sec,
                 watch_status, last_position_sec, created_at
          FROM english_dialogue_jobs
          ${whereSql}
          ORDER BY created_at DESC
          LIMIT ?`,
    args: params,
  });
  return res.rows as unknown as DialogueJobSummary[];
}

// Атомарно забирает одну queued-job воркеру. Зависшие running (claimed_at
// старше 30 мин) подбираем повторно. Один-в-один логика claimNextJob.
export async function claimNextDialogueJob(
  workerId: string,
): Promise<DialogueJobRow | null> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const pickRes = await db.execute({
    sql: `SELECT id FROM english_dialogue_jobs
          WHERE status = 'queued'
             OR (status = 'running' AND claimed_at < ?)
          ORDER BY created_at ASC
          LIMIT 1`,
    args: [staleCutoff],
  });
  const pick = pickRes.rows[0]?.id as string | undefined;
  if (!pick) return null;

  const upd = await db.execute({
    sql: `UPDATE english_dialogue_jobs
          SET status = 'running',
              stage = 'script',
              claimed_at = ?,
              claimed_by = ?,
              updated_at = ?,
              error_message = NULL
          WHERE id = ?
            AND (status = 'queued' OR (status = 'running' AND claimed_at < ?))`,
    args: [now, workerId, now, pick, staleCutoff],
  });
  if (upd.rowsAffected === 0) {
    // Кто-то опередил — пробуем следующую.
    return claimNextDialogueJob(workerId);
  }
  return getDialogueJob(pick);
}

export async function updateDialogueProgress(args: {
  id: string;
  stage?: JobStage;
  progress?: number;
  title?: string | null;
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
    sets.push("title = ?");
    params.push(args.title);
  }

  params.push(args.id);
  await db.execute({
    sql: `UPDATE english_dialogue_jobs SET ${sets.join(", ")} WHERE id = ?`,
    args: params,
  });
}

export async function markDialogueDone(args: {
  id: string;
  audioUrl: string;
  durationSec: number | null;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE english_dialogue_jobs
          SET status = 'done',
              stage = NULL,
              progress = 100,
              audio_url = ?,
              duration_sec = ?,
              updated_at = ?,
              finished_at = ?,
              error_message = NULL
          WHERE id = ?`,
    args: [args.audioUrl, args.durationSec, now, now, args.id],
  });
}

export async function markDialogueError(args: {
  id: string;
  message: string;
  errorId?: string | null;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE english_dialogue_jobs
          SET status = 'error',
              error_message = ?,
              error_id = ?,
              updated_at = ?,
              finished_at = ?
          WHERE id = ?`,
    args: [args.message.slice(0, 4000), args.errorId ?? null, now, now, args.id],
  });
}

// Перезаписывает все сегменты разговора одним батчем.
export async function replaceDialogueSegments(
  jobId: string,
  segments: Array<{
    idx: number;
    start_ms: number;
    end_ms: number;
    speaker: string | null;
    en_text: string;
    ru_text: string | null;
  }>,
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const statements = [
    { sql: `DELETE FROM english_dialogue_segments WHERE job_id = ?`, args: [jobId] },
    ...segments.map((s) => ({
      sql: `INSERT INTO english_dialogue_segments
              (job_id, idx, start_ms, end_ms, speaker, en_text, ru_text)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [jobId, s.idx, s.start_ms, s.end_ms, s.speaker, s.en_text, s.ru_text],
    })),
  ];
  await db.batch(statements, "write");
}

export async function getDialogueSegments(
  jobId: string,
): Promise<DialogueSegmentRow[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT job_id, idx, start_ms, end_ms, speaker, en_text, ru_text
          FROM english_dialogue_segments
          WHERE job_id = ?
          ORDER BY idx ASC`,
    args: [jobId],
  });
  return res.rows as unknown as DialogueSegmentRow[];
}

// Обновляет позицию воспроизведения и/или watch_status. Шлёт плеер
// (раз в ~5с и на паузе/закрытии) и кнопка «в прослушанные».
export async function updateDialoguePlayback(args: {
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
    sql: `UPDATE english_dialogue_jobs SET ${sets.join(", ")} WHERE id = ?`,
    args: params,
  });
}
