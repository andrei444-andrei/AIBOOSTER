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

  // 3. Чанкуем сегменты для TTS: вместо 1 запроса на каждые 2-3 секунды речи
  // (700+ HTTP-вызовов к ElevenLabs) объединяем подряд идущие сегменты в
  // куски до 3 минут, ломая на больших паузах. Это:
  //   • ×~50 меньше HTTP-вызовов → не упираемся в 300с Vercel
  //   • Речь звучит цельными фразами/абзацами, а не рублёными кусочками
  //   • atempo-fit делает мягкую коррекцию (~0.9–1.1×) вместо
  //     экстремальной (0.2×/5× когда фраза не помещается в свой таймкод)
  // Subtitles в /api/jobs/[id] остаются per-segment — UI рендерит их как
  // было, click-to-seek работает с точностью до позиции внутри чанка
  // (несколько секунд дрейфа в худшем случае, для аудио-перевода ок).
  const chunks = chunkForTts(translated);
  await updateJobProgress({ id: job.id, stage: "tts", progress: 58 });
  const segmentFiles: Array<{ file: string; start_ms: number; end_ms: number }> =
    new Array(chunks.length);
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
      const targetSec = Math.max(0.2, (c.end_ms - c.start_ms) / 1000);
      if (!c.text) {
        const silence = join(work, `chunk-${i}.mp3`);
        await ffmpegSilence(silence, targetSec);
        segmentFiles[i] = { file: silence, start_ms: c.start_ms, end_ms: c.end_ms };
      } else {
        const raw = await ttsSynth(c.text);
        const rawFile = join(work, `chunk-${i}-raw.mp3`);
        await writeFile(rawFile, raw);

        const rawSec = await ffprobeDuration(rawFile);
        const chunkFile = join(work, `chunk-${i}.mp3`);
        await ffmpegFit(rawFile, chunkFile, rawSec, targetSec);
        segmentFiles[i] = { file: chunkFile, start_ms: c.start_ms, end_ms: c.end_ms };
      }
      done++;
      await reportProgress();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(TTS_CONCURRENCY, chunks.length) }, () => workerLoop()),
  );

  // 4. Склейка по таймкодам. Финальную длительность считаем как MAX(end_ms)
  // последнего сегмента: Apify иногда отдаёт мусорный videoDuration (видел
  // 3600 на 15-минутном видео), а у сегментов таймкоды корректные, поэтому
  // на них и опираемся. Запас в 1 секунду — чтобы хвост последнего сегмента
  // точно не обрезался.
  await updateJobProgress({ id: job.id, stage: "mux", progress: 92 });
  const finalMp3 = join(work, "final.mp3");
  const lastEndMs = segmentFiles.reduce((m, s) => Math.max(m, s.end_ms), 0);
  const lastEndSec = lastEndMs / 1000 + 1;
  const truncateAt = tx.duration ? Math.min(tx.duration, lastEndSec) : lastEndSec;
  await ffmpegConcatTimed(segmentFiles, finalMp3, truncateAt);

  // 5. Загрузка в R2.
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
// Пустые переводы внутри чанка пропускаются как короткие паузы.
interface TtsChunk {
  text: string;
  start_ms: number;
  end_ms: number;
}

const CHUNK_MAX_MS = 180_000;
const BREAK_GAP_MS = 1_000;

function chunkForTts(
  segments: Array<{ idx: number; start_ms: number; end_ms: number; translated_text: string }>,
): TtsChunk[] {
  const chunks: TtsChunk[] = [];
  let current: TtsChunk | null = null;

  for (const s of segments) {
    const text = (s.translated_text || "").trim();
    if (!current) {
      current = { text, start_ms: s.start_ms, end_ms: s.end_ms };
      continue;
    }
    const gap = s.start_ms - current.end_ms;
    const wouldBeDuration = s.end_ms - current.start_ms;
    if (gap > BREAK_GAP_MS || wouldBeDuration > CHUNK_MAX_MS) {
      chunks.push(current);
      current = { text, start_ms: s.start_ms, end_ms: s.end_ms };
    } else {
      if (text) current.text = current.text ? `${current.text} ${text}` : text;
      current.end_ms = s.end_ms;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
