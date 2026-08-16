// CRUD над video_translation_chunks — рабочими единицами пайплайна перевода.
//
// Зачем таблица вообще существует: Vercel-функция живёт максимум 800 секунд,
// а часовое видео обрабатывается ~8 минут и упирается в этот потолок. Поэтому
// пайплайн не «прогон целиком», а набор независимых кусков: каждый переводится
// и озвучивается отдельно и сразу сохраняется сюда. Тик крона делает столько,
// сколько влезает в его бюджет, и выходит; следующий тик продолжает с того же
// места. Падение стоит один чанк, а не весь прогон вместе с оплаченным TTS.
//
// Имена таблицы и колонок — в schema.ts (CONSTITUTION §1.2: одно определение).

import { getDb, ensureSchema } from "./db";

export interface ChunkRow {
  job_id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  source_text: string;
  translated_text: string | null;
  utterances: string | null;
  audio_key: string | null;
  audio_url: string | null;
  audio_dur_ms: number | null;
  attempts: number;
  error_message: string | null;
  updated_at: string;
}

export interface ChunkUtterance {
  speaker: string | null;
  text: string;
}

// Сводка по стадиям — из неё считается прогресс для UI и решается,
// пора ли переходить к следующему этапу пайплайна.
export interface ChunkStats {
  total: number;
  translated: number;
  voiced: number;
}

// Раскладывает job на чанки. Идемпотентно по смыслу «начали заново»:
// полная перезапись, поэтому вызывается только на стадии download.
export async function replaceChunks(
  jobId: string,
  chunks: Array<{ idx: number; start_ms: number; end_ms: number; source_text: string }>,
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const statements = [
    { sql: `DELETE FROM video_translation_chunks WHERE job_id = ?`, args: [jobId] },
    ...chunks.map((c) => ({
      sql: `INSERT INTO video_translation_chunks
              (job_id, idx, start_ms, end_ms, source_text, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [jobId, c.idx, c.start_ms, c.end_ms, c.source_text, new Date().toISOString()],
    })),
  ];
  await db.batch(statements, "write");
}

export async function listChunks(jobId: string): Promise<ChunkRow[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM video_translation_chunks WHERE job_id = ? ORDER BY idx ASC`,
    args: [jobId],
  });
  return res.rows as unknown as ChunkRow[];
}

export async function getChunkStats(jobId: string): Promise<ChunkStats> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT COUNT(*) AS total,
                 SUM(CASE WHEN translated_text IS NOT NULL THEN 1 ELSE 0 END) AS translated,
                 SUM(CASE WHEN audio_key IS NOT NULL THEN 1 ELSE 0 END) AS voiced
          FROM video_translation_chunks
          WHERE job_id = ?`,
    args: [jobId],
  });
  const row = (res.rows[0] ?? {}) as Record<string, unknown>;
  return {
    total: Number(row.total ?? 0),
    translated: Number(row.translated ?? 0),
    voiced: Number(row.voiced ?? 0),
  };
}

// Чанки, которым ещё нужен перевод. Порядок по idx — слушатель получает
// начало подкаста раньше конца, если мы когда-нибудь включим прогрессивное
// воспроизведение.
export async function listChunksNeedingTranslation(jobId: string): Promise<ChunkRow[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM video_translation_chunks
          WHERE job_id = ? AND translated_text IS NULL
          ORDER BY idx ASC`,
    args: [jobId],
  });
  return res.rows as unknown as ChunkRow[];
}

// Чанки, готовые к озвучке: перевод есть, mp3 ещё нет.
export async function listChunksNeedingTts(jobId: string): Promise<ChunkRow[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM video_translation_chunks
          WHERE job_id = ? AND translated_text IS NOT NULL AND audio_key IS NULL
          ORDER BY idx ASC`,
    args: [jobId],
  });
  return res.rows as unknown as ChunkRow[];
}

export async function saveChunkTranslation(args: {
  jobId: string;
  idx: number;
  translatedText: string;
  utterances: ChunkUtterance[];
}): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE video_translation_chunks
          SET translated_text = ?, utterances = ?, error_message = NULL, updated_at = ?
          WHERE job_id = ? AND idx = ?`,
    args: [
      args.translatedText,
      JSON.stringify(args.utterances),
      new Date().toISOString(),
      args.jobId,
      args.idx,
    ],
  });
}

export async function saveChunkAudio(args: {
  jobId: string;
  idx: number;
  audioKey: string;
  audioUrl: string;
  audioDurMs: number;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE video_translation_chunks
          SET audio_key = ?, audio_url = ?, audio_dur_ms = ?, error_message = NULL, updated_at = ?
          WHERE job_id = ? AND idx = ?`,
    args: [
      args.audioKey,
      args.audioUrl,
      Math.max(0, Math.round(args.audioDurMs)),
      new Date().toISOString(),
      args.jobId,
      args.idx,
    ],
  });
}

// Отмечает неудачу по чанку и возвращает новое число попыток. Вызывающий
// решает, добить job целиком или дать чанку ещё шанс на следующем тике.
export async function markChunkFailed(args: {
  jobId: string;
  idx: number;
  message: string;
}): Promise<number> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE video_translation_chunks
          SET attempts = attempts + 1, error_message = ?, updated_at = ?
          WHERE job_id = ? AND idx = ?`,
    args: [args.message.slice(0, 1000), new Date().toISOString(), args.jobId, args.idx],
  });
  const res = await db.execute({
    sql: `SELECT attempts FROM video_translation_chunks WHERE job_id = ? AND idx = ?`,
    args: [args.jobId, args.idx],
  });
  return Number((res.rows[0] as unknown as { attempts?: number })?.attempts ?? 0);
}

export function parseUtterances(raw: string | null): ChunkUtterance[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: ChunkUtterance[] = [];
    for (const u of parsed) {
      if (!u || typeof u !== "object") continue;
      const o = u as Record<string, unknown>;
      if (typeof o.text !== "string" || !o.text) continue;
      out.push({
        speaker: typeof o.speaker === "string" ? o.speaker : null,
        text: o.text,
      });
    }
    return out;
  } catch {
    return [];
  }
}
