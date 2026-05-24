// Полный пайплайн перевода одного видео — выполняется внутри одной
// Vercel-функции (cron-тика), от заявленного job'а до загруженного mp3.
//
// Этапы (прогресс, который видит пользователь):
//   download (0..30)  — Apify тянет транскрипт с таймкодами + метаданные
//   translate(30..55) — LLM-перевод сегментов с сохранением их idx
//   tts      (55..90) — ElevenLabs (multilingual v2) — синтез по сегментам
//                       с подгонкой длительности под исходный таймкод (atempo)
//   mux      (90..100)— склейка финального mp3 → загрузка в R2

import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  markJobDone,
  markJobError,
  replaceSegments,
  updateJobProgress,
  type JobRow,
} from "@/lib/jobs";
import { logError } from "@/lib/logger";
import { fetchTranscript } from "./apify";
import { translateBatch, ttsSynth } from "./aimlapi";
import {
  ffmpegConcatTimed,
  ffmpegFit,
  ffmpegSilence,
  ffprobeDuration,
} from "./ffmpeg";
import { uploadMp3 } from "./storage";

const MAX_DURATION_SEC = 60 * 60;
// Vercel Function cap = 300 секунд. Эмпирически с batched-mux (50 сегментов
// на батч) укладываемся в этот бюджет до ~1000 сегментов (≈40-60 мин речи).
// Над этим — TTS-этап начинает грозить таймаутом.
const MAX_SEGMENTS = 1000;

export async function runJob(job: JobRow): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), `job-${job.id}-`));
  try {
    await runPipeline(job, work);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const errorId = await logError({
      level: "error",
      source: "server",
      route: "/api/cron/process-jobs",
      message,
      stack: stack ?? null,
      meta: { job_id: job.id, video_id: job.yt_video_id },
    });
    await markJobError({ id: job.id, message, errorId });
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

async function runPipeline(job: JobRow, work: string): Promise<void> {
  // 1. Транскрипт + метаданные через Apify.
  await updateJobProgress({ id: job.id, stage: "download", progress: 5 });
  const ytUrl = `https://www.youtube.com/watch?v=${job.yt_video_id}`;
  const tx = await fetchTranscript(ytUrl);
  if (tx.duration && tx.duration > MAX_DURATION_SEC) {
    throw new Error(
      `видео слишком длинное: ${Math.round(tx.duration / 60)} мин (лимит 60)`,
    );
  }
  if (tx.segments.length > MAX_SEGMENTS) {
    throw new Error(
      `слишком много сегментов: ${tx.segments.length} (лимит ${MAX_SEGMENTS}). ` +
        `Vercel-функция не успеет за 5 минут. Возьми видео покороче (обычно ≤ 40 мин).`,
    );
  }
  await updateJobProgress({
    id: job.id,
    title: tx.title,
    durationSec: tx.duration,
    sourceLang: tx.language,
    stage: "download",
    progress: 28,
  });
  await replaceSegments(
    job.id,
    tx.segments.map((s) => ({
      idx: s.idx,
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      source_text: s.text,
    })),
  );

  // 2. Перевод.
  await updateJobProgress({ id: job.id, stage: "translate", progress: 32 });
  const translated = await translateBatch(tx.segments, {
    sourceLang: tx.language,
    targetLang: job.target_lang,
  });
  await updateJobProgress({ id: job.id, stage: "translate", progress: 55 });
  await replaceSegments(
    job.id,
    translated.map((s) => ({
      idx: s.idx,
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      source_text: s.text,
      translated_text: s.translated_text,
    })),
  );

  // 3. TTS по сегментам + подгонка длительности — параллельно (concurrency=6),
  // иначе на длинных видео сумма HTTP latency aimlapi не влезает в 300с
  // Vercel-функции. Меньше 6 — медленно, больше — aimlapi начинает 524.
  await updateJobProgress({ id: job.id, stage: "tts", progress: 58 });
  const segmentFiles: Array<{ file: string; start_ms: number; end_ms: number }> =
    new Array(translated.length);
  const TTS_CONCURRENCY = 6;
  let nextIdx = 0;
  let done = 0;
  let lastReportedAt = 0;
  async function reportProgress() {
    if (Date.now() - lastReportedAt < 1500) return;
    lastReportedAt = Date.now();
    const p = 58 + Math.round((32 * done) / translated.length);
    await updateJobProgress({
      id: job.id,
      stage: "tts",
      progress: Math.min(p, 90),
    });
  }
  async function workerLoop(): Promise<void> {
    for (;;) {
      const i = nextIdx++;
      if (i >= translated.length) return;
      const s = translated[i];
      const text = (s.translated_text || "").trim();
      if (!text) {
        const silence = join(work, `seg-${i}.mp3`);
        await ffmpegSilence(silence, Math.max(0.1, (s.end_ms - s.start_ms) / 1000));
        segmentFiles[i] = { file: silence, start_ms: s.start_ms, end_ms: s.end_ms };
      } else {
        const raw = await ttsSynth(text);
        const rawFile = join(work, `seg-${i}-raw.mp3`);
        await writeFile(rawFile, raw);

        const targetSec = Math.max(0.2, (s.end_ms - s.start_ms) / 1000);
        const rawSec = await ffprobeDuration(rawFile);
        const segFile = join(work, `seg-${i}.mp3`);
        await ffmpegFit(rawFile, segFile, rawSec, targetSec);
        segmentFiles[i] = { file: segFile, start_ms: s.start_ms, end_ms: s.end_ms };
      }
      done++;
      await reportProgress();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(TTS_CONCURRENCY, translated.length) }, () => workerLoop()),
  );

  // 4. Склейка по таймкодам.
  await updateJobProgress({ id: job.id, stage: "mux", progress: 92 });
  const finalMp3 = join(work, "final.mp3");
  await ffmpegConcatTimed(segmentFiles, finalMp3, tx.duration);

  // 5. Загрузка в R2.
  await updateJobProgress({ id: job.id, stage: "mux", progress: 96 });
  const data = await readFile(finalMp3);
  const key = `translations/${job.yt_video_id}/${job.target_lang}/${job.id}.mp3`;
  const audioUrl = await uploadMp3(key, data);

  await markJobDone({ id: job.id, audioUrl });
}
