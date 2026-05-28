// Пайплайн перевода YouTube → переведённый аудио-подкаст.
//
// Подкаст-режим: переведённая речь звучит в натуральном темпе TTS, без
// принудительной подгонки под исходные таймкоды. Финальный mp3 короче
// видео (русский плотнее английского), но звучит естественно — слушаешь
// как подкаст, опционально рядом крутится оригинал.
//
// Этапы (с прогрессом для пользователя):
//   download (0..30)  — Apify тянет транскрипт с таймкодами + метаданные
//   translate(30..55) — LLM-перевод сегментов с сохранением их idx
//   tts      (55..90) — ElevenLabs синтезирует чанки (по ~3 мин речи),
//                       нормализуем mp3-формат для concat
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
import { translateBatch, ttsSynth, type TranslatedSegment } from "./aimlapi";
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
  // готов, в UI видны исходные субтитры.
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

  // 3. TTS — чанками ~3 мин, никакого atempo (подкаст-режим).
  // Каждый чанк синтезируется в натуральном темпе.
  const chunks = chunkForTts(translated);
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
      if (!c.text) {
        // Чанк без перевода — короткая тишина (полсекунды). Без неё в
        // подкасте «пропадёт» граница, но 0 длительности тоже не нужно
        // — concat-демуксер может ругнуться.
        await ffmpegSilence(outFile, 0.5);
      } else {
        const raw = await ttsSynth(c.text);
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

  // 4. Сборка output-таймлайна. Чанки склеиваются подряд, ремапим исходные
  // сегменты в новые позиции (пропорционально внутри чанка). Это даёт
  // транскрипту-плееру в UI правильный click-to-seek по подкасту.
  const podcastChunkFiles: Array<{ file: string; start_ms: number; end_ms: number }> = [];
  const remappedSegments: Array<{
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

    const inputDur = c.end_ms - c.start_ms;
    const outputDur = chunkEndMs - chunkStartMs;
    for (const seg of c.sourceSegments) {
      // Пропорциональный пересчёт: позиция сегмента внутри чанка в
      // исходном таймлайне → та же доля в output-чанке.
      const relStart = inputDur > 0 ? (seg.start_ms - c.start_ms) / inputDur : 0;
      const relEnd = inputDur > 0 ? (seg.end_ms - c.start_ms) / inputDur : 1;
      remappedSegments.push({
        idx: seg.idx,
        start_ms: Math.round(chunkStartMs + relStart * outputDur),
        end_ms: Math.round(chunkStartMs + relEnd * outputDur),
        source_text: seg.text,
        translated_text: seg.translated_text,
      });
    }
    cursorMs = chunkEndMs;
  }
  // Перезаписываем сегменты с подкаст-таймлайном — теперь они синхронны
  // с финальным mp3, не с YouTube-видео.
  await replaceSegments(job.id, remappedSegments);

  // 5. Склейка mp3 в один трек. Чанки идут подряд (start[i+1] = end[i]),
  // так что ffmpegConcatTimed не вставит silence-гэпы.
  await updateJobProgress({ id: job.id, stage: "mux", progress: 92 });
  const finalMp3 = join(work, "final.mp3");
  await ffmpegConcatTimed(podcastChunkFiles, finalMp3, null);

  // 6. Загрузка в R2.
  await updateJobProgress({ id: job.id, stage: "mux", progress: 96 });
  const data = await readFile(finalMp3);
  const key = `translations/${job.yt_video_id}/${job.target_lang}/${job.id}.mp3`;
  const audioUrl = await uploadMp3(key, data);

  await markJobDone({ id: job.id, audioUrl });
}

// Группирует подряд идущие сегменты в TTS-чанки. Логика:
//   • Внутри чанка — суммарная длительность < CHUNK_MAX_MS (3 мин)
//   • Чанк закрывается, если до следующего сегмента gap > BREAK_GAP_MS
//     (естественная пауза говорящего — хорошая граница)
//   • Чанк закрывается, если добавление следующего сегмента превысит
//     CHUNK_MAX_MS
// Сохраняем ссылки на исходные сегменты — нужно для ремаппинга
// субтитров на output-таймлайн после TTS.
interface TtsChunk {
  text: string;
  start_ms: number;
  end_ms: number;
  sourceSegments: TranslatedSegment[];
}

const CHUNK_MAX_MS = 180_000;
const BREAK_GAP_MS = 1_000;

function chunkForTts(segments: TranslatedSegment[]): TtsChunk[] {
  const chunks: TtsChunk[] = [];
  let current: TtsChunk | null = null;

  for (const s of segments) {
    const text = (s.translated_text || "").trim();
    if (!current) {
      current = {
        text,
        start_ms: s.start_ms,
        end_ms: s.end_ms,
        sourceSegments: [s],
      };
      continue;
    }
    const gap = s.start_ms - current.end_ms;
    const wouldBeDuration = s.end_ms - current.start_ms;
    if (gap > BREAK_GAP_MS || wouldBeDuration > CHUNK_MAX_MS) {
      chunks.push(current);
      current = {
        text,
        start_ms: s.start_ms,
        end_ms: s.end_ms,
        sourceSegments: [s],
      };
    } else {
      if (text) current.text = current.text ? `${current.text} ${text}` : text;
      current.end_ms = s.end_ms;
      current.sourceSegments.push(s);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
