// Пайплайн перевода YouTube → переведённый аудио-подкаст.
//
// Подкаст-режим: переведённая речь звучит в натуральном темпе TTS, без
// принудительной подгонки под исходные таймкоды. Финальный mp3 короче
// видео (русский плотнее английского), но звучит естественно.
//
// Перевод и TTS идут на уровне ЧАНКОВ (~3 минуты речи), а не отдельных
// YouTube-субтитров. YouTube режет речь на куски по 1-3 секунды, часто
// посреди предложения — переводить такие куски пословно даёт неестественный
// результат. Чанк собирается на естественных паузах говорящего и попадает
// в переводчик как цельный абзац — модель свободно меняет порядок слов
// и переформулирует под язык. TTS читает связный текст, не отрывки.
//
// Этапы (с прогрессом для пользователя):
//   download (0..30)  — Apify тянет транскрипт с таймкодами + метаданные
//   translate(30..55) — LLM-перевод каждого чанка цельным абзацем
//   tts      (55..90) — ElevenLabs синтезирует чанки, нормализуем mp3-формат
//   mux      (90..100)— подряд склеиваем чанки, загружаем в R2

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
import { translateChunk, ttsSynth, type SegmentInput } from "./aimlapi";
import {
  ffmpegConcatTimed,
  ffmpegNormalize,
  ffmpegSilence,
  ffprobeDuration,
} from "./ffmpeg";
import { uploadMp3 } from "./storage";

const MAX_DURATION_SEC = 60 * 60;
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
  // Изначально сохраняем сегменты с YouTube-таймкодами — пока перевод не
  // готов, в UI видны исходные субтитры по сегментам.
  await replaceSegments(
    job.id,
    tx.segments.map((s) => ({
      idx: s.idx,
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      source_text: s.text,
    })),
  );

  // 2. Группировка исходных сегментов в чанки (~3 мин на естественных паузах).
  await updateJobProgress({ id: job.id, stage: "translate", progress: 32 });
  const chunks = chunkSourceSegments(tx.segments);

  // 3. Перевод каждого чанка цельным абзацем — параллельно, чтобы не ждать
  // 10+ HTTP-запросов последовательно для длинных видео.
  const TRANSLATE_CONCURRENCY = 4;
  let translateNextIdx = 0;
  let translateDone = 0;
  let lastTranslateReportAt = 0;
  async function reportTranslateProgress() {
    if (Date.now() - lastTranslateReportAt < 1500) return;
    lastTranslateReportAt = Date.now();
    const p = 32 + Math.round((23 * translateDone) / chunks.length);
    await updateJobProgress({
      id: job.id,
      stage: "translate",
      progress: Math.min(p, 55),
    });
  }
  async function translateWorker(): Promise<void> {
    for (;;) {
      const i = translateNextIdx++;
      if (i >= chunks.length) return;
      const c = chunks[i];
      c.translated_text = await translateChunk(c.source_text, {
        sourceLang: tx.language,
        targetLang: job.target_lang,
      });
      translateDone++;
      await reportTranslateProgress();
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(TRANSLATE_CONCURRENCY, chunks.length) },
      () => translateWorker(),
    ),
  );
  await updateJobProgress({ id: job.id, stage: "translate", progress: 55 });

  // 4. TTS — каждый чанк синтезируется в натуральном темпе.
  await updateJobProgress({ id: job.id, stage: "tts", progress: 58 });
  const chunkOut: Array<{ file: string; durationSec: number } | null> =
    new Array(chunks.length).fill(null);
  const TTS_CONCURRENCY = 4;
  let nextIdx = 0;
  let done = 0;
  let lastReportedAt = 0;
  async function reportProgress() {
    if (Date.now() - lastReportedAt < 1500) return;
    lastReportedAt = Date.now();
    const p = 58 + Math.round((32 * done) / chunks.length);
    await updateJobProgress({
      id: job.id,
      stage: "tts",
      progress: Math.min(p, 90),
    });
  }
  async function workerLoop(): Promise<void> {
    for (;;) {
      const i = nextIdx++;
      if (i >= chunks.length) return;
      const c = chunks[i];
      const outFile = join(work, `chunk-${i}.mp3`);
      if (!c.translated_text) {
        // Пустой чанк (например, чанк состоял только из филлеров типа
        // "[Music]") — короткая тишина вместо TTS.
        await ffmpegSilence(outFile, 0.5);
      } else {
        const raw = await ttsSynth(c.translated_text);
        const rawFile = join(work, `chunk-${i}-raw.mp3`);
        await writeFile(rawFile, raw);
        await ffmpegNormalize(rawFile, outFile);
      }
      const durationSec = await ffprobeDuration(outFile);
      chunkOut[i] = { file: outFile, durationSec };
      done++;
      await reportProgress();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(TTS_CONCURRENCY, chunks.length) }, () => workerLoop()),
  );

  // 5. Сборка output-таймлайна. Чанки идут подряд. Транскрипт в UI теперь
  // тоже на уровне чанков (одна строка = один чанк ≈ 3 мин речи). Точность
  // click-to-seek падает до «начала чанка», но переводы стали связными —
  // для подкаст-плеера паттерн «слушаем абзацами» естественнее.
  const podcastChunkFiles: Array<{ file: string; start_ms: number; end_ms: number }> = [];
  const chunkSegments: Array<{
    idx: number;
    start_ms: number;
    end_ms: number;
    source_text: string;
    translated_text: string;
  }> = [];
  let cursorMs = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const r = chunkOut[i];
    if (!r) continue;
    const chunkStartMs = cursorMs;
    const chunkEndMs = cursorMs + Math.round(r.durationSec * 1000);
    podcastChunkFiles.push({ file: r.file, start_ms: chunkStartMs, end_ms: chunkEndMs });
    chunkSegments.push({
      idx: i,
      start_ms: chunkStartMs,
      end_ms: chunkEndMs,
      source_text: c.source_text,
      translated_text: c.translated_text,
    });
    cursorMs = chunkEndMs;
  }
  // Перезаписываем — вместо сотен per-segment EN-строк теперь N строк
  // по числу чанков, у каждой полный текст оригинала и связный перевод.
  await replaceSegments(job.id, chunkSegments);

  // 6. Склейка mp3 в один трек.
  await updateJobProgress({ id: job.id, stage: "mux", progress: 92 });
  const finalMp3 = join(work, "final.mp3");
  await ffmpegConcatTimed(podcastChunkFiles, finalMp3, null);

  // 7. Загрузка в R2.
  await updateJobProgress({ id: job.id, stage: "mux", progress: 96 });
  const data = await readFile(finalMp3);
  const key = `translations/${job.yt_video_id}/${job.target_lang}/${job.id}.mp3`;
  const audioUrl = await uploadMp3(key, data);

  await markJobDone({ id: job.id, audioUrl });
}

// Группирует подряд идущие сегменты в чанки для перевода и TTS. Работаем
// с исходным текстом — перевод придёт поверх готового чанка одной строкой,
// и тот же чанк станет одной строкой транскрипта в UI.
interface SourceChunk {
  start_ms: number;
  end_ms: number;
  source_text: string;
  translated_text: string;
}

const CHUNK_MAX_MS = 180_000;
const BREAK_GAP_MS = 1_000;

function chunkSourceSegments(segments: SegmentInput[]): SourceChunk[] {
  const chunks: SourceChunk[] = [];
  let current: SourceChunk | null = null;

  for (const s of segments) {
    const text = (s.text || "").trim();
    if (!current) {
      current = {
        start_ms: s.start_ms,
        end_ms: s.end_ms,
        source_text: text,
        translated_text: "",
      };
      continue;
    }
    const gap = s.start_ms - current.end_ms;
    const wouldBeDuration = s.end_ms - current.start_ms;
    if (gap > BREAK_GAP_MS || wouldBeDuration > CHUNK_MAX_MS) {
      chunks.push(current);
      current = {
        start_ms: s.start_ms,
        end_ms: s.end_ms,
        source_text: text,
        translated_text: "",
      };
    } else {
      if (text) {
        current.source_text = current.source_text
          ? `${current.source_text} ${text}`
          : text;
      }
      current.end_ms = s.end_ms;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
