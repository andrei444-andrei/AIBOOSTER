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
// РЕЗЮМИРУЕМОСТЬ. Раньше весь прогон был одной инвокацией Vercel-функции, и
// всё, что не влезало в её лимит, отбраковывалось на входе («видео длиннее
// 40 минут — возьми покороче»). Теперь пайплайн — стейт-машина поверх
// таблицы video_translation_chunks: каждый переведённый и озвученный кусок
// сразу сохраняется, а тик работает по дедлайну и выходит, когда бюджет
// кончился. Следующий тик крона продолжает с того же места. Отсюда:
//   - видео любой длины обрабатывается за несколько тиков;
//   - падение стоит один чанк, а не весь прогон с уже оплаченным TTS;
//   - ретрай упавшей job переиспользует всё, что успело сделаться.
//
// Этапы (с прогрессом для пользователя):
//   download (0..30)  — Apify тянет транскрипт с таймкодами + метаданные,
//                       раскладываем его на чанки
//   translate(30..55) — LLM-перевод каждого чанка цельным абзацем
//   tts      (55..90) — ElevenLabs синтезирует чанки, каждый уезжает в R2
//   mux      (90..100)— склеиваем чанки подряд, загружаем итог в R2

import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  markJobDone,
  markJobError,
  replaceSegments,
  saveJobMeta,
  touchJobClaim,
  updateJobProgress,
  type JobRow,
  type JobStage,
} from "@/lib/jobs";
import {
  getChunkStats,
  listChunks,
  listChunksNeedingTranslation,
  listChunksNeedingTts,
  markChunkFailed,
  parseUtterances,
  replaceChunks,
  saveChunkAudio,
  saveChunkTranslation,
  type ChunkRow,
} from "@/lib/chunks";
import { logError } from "@/lib/logger";
import { fetchTranscript } from "./apify";
import { translateChunk, ttsSynth, type SegmentInput, type TranslatedUtterance } from "./aimlapi";
import {
  ffmpegConcatTimed,
  ffmpegNormalize,
  ffmpegSilence,
  ffprobeDuration,
} from "./ffmpeg";
import { downloadObject, uploadMp3 } from "./storage";
import { generateVideoMeta } from "./summary";

// Предел не технический, а денежный: 6 часов речи — это уже не «видео»,
// а чей-то стрим целиком, и счёт за TTS будет соответствующий. Раньше здесь
// стоял час, потому что дальше не дотягивала одна инвокация функции; теперь
// длина упирается только в здравый смысл.
const MAX_DURATION_SEC = 6 * 60 * 60;

// Сколько попыток даём одному чанку, прежде чем признать job неудачной.
// Транзиентные 5xx от aimlapi лечатся ретраем на следующем тике.
const MAX_CHUNK_ATTEMPTS = 3;

// Стадия mux неделима: ей нужны все чанки разом. Не начинаем её, если до
// конца бюджета осталось меньше — иначе функцию убьют на середине склейки
// и следующий тик будет делать ту же работу заново. Запас посчитан по
// худшему случаю: скачать из R2 ~150 МБ чанков и перекодировать несколько
// часов аудио в один mp3.
const MUX_MIN_BUDGET_MS = 240_000;

const TRANSLATE_CONCURRENCY = 8;
const TTS_CONCURRENCY = 8;

// Голоса ElevenLabs для разных спикеров диалога. A → дефолт (хост / первый
// говорящий), B → контрастный голос (гость / собеседник), дальше по списку.
// Для монолога speaker=null → DEFAULT_VOICE.
const VOICE_MAP: Record<string, string> = {
  A: "Rachel",
  B: "Adam",
  C: "Bella",
  D: "Antoni",
  E: "Domi",
  F: "Josh",
};
const DEFAULT_VOICE = "Rachel";

function voiceFor(speaker: string | null): string {
  if (!speaker) return DEFAULT_VOICE;
  return VOICE_MAP[speaker] ?? DEFAULT_VOICE;
}

// Превращает массив реплик в одну строку для транскрипта. Для монолога —
// просто склейка. Для диалога — с метками [A]: / [B]: чтобы видно кто
// говорит. Метки в UI остаются как есть — пользователь читает и видит
// смену реплик.
function utterancesToText(utts: TranslatedUtterance[]): string {
  if (utts.length === 0) return "";
  const hasSpeakers = utts.some((u) => u.speaker !== null);
  if (!hasSpeakers || utts.length === 1) {
    return utts.map((u) => u.text).join(" ");
  }
  return utts
    .map((u) => (u.speaker ? `[${u.speaker}] ${u.text}` : u.text))
    .join("\n");
}

export interface JobSliceResult {
  // false — работа осталась, job всё ещё 'running', продолжит следующий тик.
  finished: boolean;
  stage: JobStage | null;
}

// Прогоняет job столько, сколько влезает в дедлайн. Возвращает finished=true,
// когда job доведена до терминального состояния (done или error).
export async function runJob(job: JobRow, deadline: number): Promise<JobSliceResult> {
  const work = await mkdtemp(join(tmpdir(), `job-${job.id}-`));
  try {
    return await runPipeline(job, work, deadline);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const errorId = await logError({
      level: "error",
      source: "server",
      route: "/api/cron/process-jobs",
      message,
      stack: stack ?? null,
      meta: { job_id: job.id, video_id: job.yt_video_id, stage: job.stage },
    });
    await markJobError({ id: job.id, message, errorId });
    return { finished: true, stage: job.stage };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

async function runPipeline(
  job: JobRow,
  work: string,
  deadline: number,
): Promise<JobSliceResult> {
  let stage: JobStage = job.stage ?? "download";

  // Job из до-чанковой эпохи (или та, у которой стадия ушла вперёд, а чанки
  // не создались) не имеет рабочих единиц — ей нечего доделывать. Отправляем
  // такую в начало, иначе ретрай упирался бы в «нет ни одного фрагмента».
  if (stage !== "download" && stage !== "asr") {
    const stats = await getChunkStats(job.id);
    if (stats.total === 0) stage = "download";
  }

  // Стадии идут строго по порядку, каждая начинается только если предыдущая
  // домолотила все свои чанки. Между ними проверяем бюджет: вышло время —
  // выходим, состояние уже в БД, следующий тик подхватит.
  if (stage === "download" || stage === "asr") {
    await stageDownload(job);
    stage = "translate";
  }

  if (stage === "translate") {
    const complete = await stageTranslate(job, deadline);
    if (!complete) return { finished: false, stage: "translate" };
    stage = "tts";
  }

  if (stage === "tts") {
    const complete = await stageTts(job, work, deadline);
    if (!complete) return { finished: false, stage: "tts" };
    stage = "mux";
  }

  // На mux заходим только с запасом времени — она неделима.
  if (Date.now() + MUX_MIN_BUDGET_MS > deadline) {
    await updateJobProgress({ id: job.id, stage: "mux", progress: 90 });
    return { finished: false, stage: "mux" };
  }
  await stageMux(job, work);
  return { finished: true, stage: null };
}

// --- Этап 1: транскрипт с YouTube → сегменты + чанки в БД ------------------

async function stageDownload(job: JobRow): Promise<void> {
  await updateJobProgress({ id: job.id, stage: "download", progress: 5 });
  const ytUrl = `https://www.youtube.com/watch?v=${job.yt_video_id}`;
  const tx = await fetchTranscript(ytUrl);

  // Apify отдаёт длительность не для всех роликов, поэтому если её нет —
  // берём конец последнего сегмента. Раньше поле просто оставалось NULL,
  // и проверка длины не срабатывала никогда.
  const lastEndMs = tx.segments.length
    ? tx.segments[tx.segments.length - 1].end_ms
    : 0;
  const durationSec = tx.duration ?? (lastEndMs > 0 ? Math.round(lastEndMs / 1000) : null);
  if (durationSec && durationSec > MAX_DURATION_SEC) {
    throw new Error(
      `видео слишком длинное: ${Math.round(durationSec / 60)} мин ` +
        `(максимум ${MAX_DURATION_SEC / 3600} часов)`,
    );
  }

  await updateJobProgress({
    id: job.id,
    // title пишем только если Apify реально что-то вернул — иначе можем
    // затереть значение, которое мы заранее подтянули через oEmbed при
    // создании джоба.
    title: tx.title ?? undefined,
    durationSec,
    sourceLang: tx.language,
    stage: "download",
    progress: 20,
  });
  // Держим in-memory job в синхроне с БД: перевод в этом же тике пойдёт
  // сразу после download и должен знать распознанный исходный язык.
  job.source_lang = tx.language;
  job.yt_duration_sec = durationSec;

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

  // Группировка исходных сегментов в чанки (~3 мин на естественных паузах).
  // С этого момента вся работа адресуется чанками и переживает перезапуск.
  const chunks = chunkSourceSegments(tx.segments);
  await replaceChunks(
    job.id,
    chunks.map((c, idx) => ({
      idx,
      start_ms: c.start_ms,
      end_ms: c.end_ms,
      source_text: c.source_text,
    })),
  );
  await updateJobProgress({ id: job.id, stage: "translate", progress: 30 });
}

// --- Этап 2: перевод чанков ------------------------------------------------

// Возвращает true, если переведены все чанки; false — вышло время.
async function stageTranslate(job: JobRow, deadline: number): Promise<boolean> {
  const pending = await listChunksNeedingTranslation(job.id);
  const stats = await getChunkStats(job.id);
  if (pending.length === 0) return true;

  let done = stats.translated;
  const total = Math.max(stats.total, 1);

  await forEachChunk(pending, TRANSLATE_CONCURRENCY, deadline, async (c) => {
    const utts = await translateChunk(c.source_text, {
      sourceLang: job.source_lang,
      targetLang: job.target_lang,
    });
    await saveChunkTranslation({
      jobId: job.id,
      idx: c.idx,
      translatedText: utterancesToText(utts),
      utterances: utts,
    });
    done++;
    await touchJobClaim(job.id);
    await updateJobProgress({
      id: job.id,
      stage: "translate",
      progress: Math.min(30 + Math.round((25 * done) / total), 55),
    });
  }, job);

  // Судим по факту в БД, а не по тому, дошёл ли цикл до конца: чанк мог
  // упасть на транзиентной ошибке и остаться без перевода. Тогда стадия
  // не закрыта — доберём его следующим тиком (или добьём job, когда
  // попытки кончатся).
  const left = await listChunksNeedingTranslation(job.id);
  if (left.length > 0) return false;
  await updateJobProgress({ id: job.id, stage: "tts", progress: 56 });
  return true;
}

// --- Этап 3: озвучка чанков ------------------------------------------------

// Возвращает true, если озвучены все чанки; false — вышло время.
async function stageTts(job: JobRow, work: string, deadline: number): Promise<boolean> {
  const pending = await listChunksNeedingTts(job.id);
  const stats = await getChunkStats(job.id);
  if (pending.length === 0) return true;

  let done = stats.voiced;
  const total = Math.max(stats.total, 1);

  await forEachChunk(pending, TTS_CONCURRENCY, deadline, async (c) => {
    const outFile = join(work, `chunk-${c.idx}.mp3`);
    await synthChunk(c, work, outFile);
    const durationSec = await ffprobeDuration(outFile);

    // Чанк уезжает в R2 сразу: /tmp этой функции умрёт вместе с ней, а
    // стадия mux может случиться уже в другом тике крона.
    const key = `translations/${job.yt_video_id}/${job.target_lang}/${job.id}/chunk-${String(
      c.idx,
    ).padStart(4, "0")}.mp3`;
    const data = await readFile(outFile);
    const url = await uploadMp3(key, data);
    await saveChunkAudio({
      jobId: job.id,
      idx: c.idx,
      audioKey: key,
      audioUrl: url,
      audioDurMs: Math.round(durationSec * 1000),
    });
    // Место в /tmp ограничено (~500 МБ), а трёхчасовое видео — это сотни
    // мегабайт чанков. Отработанные файлы убираем сразу.
    await rm(outFile, { force: true }).catch(() => {});

    done++;
    await touchJobClaim(job.id);
    await updateJobProgress({
      id: job.id,
      stage: "tts",
      progress: Math.min(56 + Math.round((34 * done) / total), 90),
    });
  }, job);

  const left = await listChunksNeedingTts(job.id);
  if (left.length > 0) return false;
  await updateJobProgress({ id: job.id, stage: "mux", progress: 90 });
  return true;
}

// Синтезирует один чанк в outFile. Монолог — одна TTS-сессия; диалог —
// по реплике на голос, потом склейка подряд.
async function synthChunk(c: ChunkRow, work: string, outFile: string): Promise<void> {
  // Обычно реплики со спикерами лежат в utterances. Если разметка почему-то
  // не сохранилась, а перевод есть — озвучиваем его как монолог: потерять
  // три минуты содержания из-за битого JSON нельзя.
  let utts = parseUtterances(c.utterances);
  if (utts.length === 0 && c.translated_text) {
    utts = [{ speaker: null, text: c.translated_text }];
  }
  const hasSpeakers = utts.some((u) => u.speaker !== null);
  const multiVoice = hasSpeakers && utts.length > 1;

  if (utts.length === 0 || utts.every((u) => !u.text)) {
    // Пустой чанк (например, состоял только из филлеров) → тишина.
    await ffmpegSilence(outFile, 0.5);
    return;
  }

  if (!multiVoice) {
    // Монолог: одна TTS-сессия дефолтным голосом — звучит гораздо ровнее
    // чем стык независимо синтезированных предложений.
    const joined = utts.map((u) => u.text).join(" ");
    const raw = await ttsSynth(joined, { voice: voiceFor(utts[0]?.speaker ?? null) });
    const rawFile = join(work, `chunk-${c.idx}-raw.mp3`);
    await writeFile(rawFile, raw);
    await ffmpegNormalize(rawFile, outFile);
    await rm(rawFile, { force: true }).catch(() => {});
    return;
  }

  // Диалог: каждая реплика синтезируется своим голосом, потом склеиваются
  // подряд. Между репликами никаких пауз — естественный ритм даёт сама
  // смена голосов.
  const utterFiles: Array<{ file: string; start_ms: number; end_ms: number }> = [];
  let cursorMs = 0;
  for (let j = 0; j < utts.length; j++) {
    const u = utts[j];
    const utterOut = join(work, `chunk-${c.idx}-utter-${j}.mp3`);
    if (!u.text) {
      await ffmpegSilence(utterOut, 0.3);
    } else {
      const raw = await ttsSynth(u.text, { voice: voiceFor(u.speaker) });
      const rawFile = join(work, `chunk-${c.idx}-utter-${j}-raw.mp3`);
      await writeFile(rawFile, raw);
      await ffmpegNormalize(rawFile, utterOut);
      await rm(rawFile, { force: true }).catch(() => {});
    }
    const d = await ffprobeDuration(utterOut);
    const durMs = Math.round(d * 1000);
    utterFiles.push({ file: utterOut, start_ms: cursorMs, end_ms: cursorMs + durMs });
    cursorMs += durMs;
  }
  await ffmpegConcatTimed(utterFiles, outFile, null);
  for (const f of utterFiles) await rm(f.file, { force: true }).catch(() => {});
}

// --- Этап 4: сборка итогового трека ---------------------------------------

async function stageMux(job: JobRow, work: string): Promise<void> {
  const chunks = await listChunks(job.id);
  const voiced = chunks.filter((c) => c.audio_key);
  if (voiced.length === 0) {
    throw new Error("не удалось озвучить ни одного фрагмента");
  }

  // Сборка output-таймлайна. Чанки идут подряд. Транскрипт в UI теперь
  // тоже на уровне чанков (одна строка = один чанк ≈ 3 мин речи). Точность
  // click-to-seek падает до «начала чанка», но переводы стали связными —
  // для подкаст-плеера паттерн «слушаем абзацами» естественнее.
  await updateJobProgress({ id: job.id, stage: "mux", progress: 91 });
  const podcastChunkFiles: Array<{ file: string; start_ms: number; end_ms: number }> = [];
  const chunkSegments: Array<{
    idx: number;
    start_ms: number;
    end_ms: number;
    source_text: string;
    translated_text: string;
  }> = [];
  let cursorMs = 0;
  for (const c of voiced) {
    const file = join(work, `mux-${String(c.idx).padStart(4, "0")}.mp3`);
    await writeFile(file, await downloadObject(c.audio_key!));
    const chunkStartMs = cursorMs;
    const chunkEndMs = cursorMs + (c.audio_dur_ms ?? 0);
    podcastChunkFiles.push({ file, start_ms: chunkStartMs, end_ms: chunkEndMs });
    chunkSegments.push({
      idx: c.idx,
      start_ms: chunkStartMs,
      end_ms: chunkEndMs,
      source_text: c.source_text,
      translated_text: c.translated_text ?? "",
    });
    cursorMs = chunkEndMs;
  }
  // Перезаписываем — вместо сотен per-segment EN-строк теперь N строк
  // по числу чанков, у каждой полный текст оригинала и связный перевод.
  await replaceSegments(job.id, chunkSegments);

  // Summary + автоматические главы по смыслу. Делаем перед склейкой —
  // если LLM упадёт, всё равно отдадим пользователю аудио (loggable но не
  // фатально). Берём output-таймкоды чанков, чтобы главы попадали в
  // реальные секунды финального mp3, а не в оригинальный YouTube-таймлайн.
  try {
    const meta = await generateVideoMeta({
      chunks: chunkSegments.map((c) => ({
        start_sec: c.start_ms / 1000,
        text: c.translated_text,
      })),
      targetLang: job.target_lang,
      durationSec: cursorMs / 1000,
    });
    await saveJobMeta({
      id: job.id,
      summary: meta.summary,
      chapters: meta.chapters,
    });
  } catch (err) {
    // Не валим всю работу из-за meta — это украшение, не критика.
    await logError({
      level: "warn",
      source: "server",
      route: "/api/cron/process-jobs",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack ?? null : null,
      meta: { job_id: job.id, phase: "generate-meta" },
    });
  }

  // Склейка mp3 в один трек.
  await updateJobProgress({ id: job.id, stage: "mux", progress: 94 });
  const finalMp3 = join(work, "final.mp3");
  await ffmpegConcatTimed(podcastChunkFiles, finalMp3, null);
  for (const p of podcastChunkFiles) await rm(p.file, { force: true }).catch(() => {});

  // Загрузка в R2.
  await updateJobProgress({ id: job.id, stage: "mux", progress: 97 });
  const data = await readFile(finalMp3);
  const key = `translations/${job.yt_video_id}/${job.target_lang}/${job.id}.mp3`;
  const audioUrl = await uploadMp3(key, data);

  await markJobDone({ id: job.id, audioUrl });
}

// --- Общий воркер по чанкам ------------------------------------------------

// Гоняет handler по чанкам с заданным параллелизмом, пока есть время.
// Закрыта ли стадия — решает вызывающий по состоянию в БД, а не по тому,
// докрутился ли этот цикл до конца.
//
// Новый чанк не начинаем, если бюджет уже вышел: незавершённый чанк —
// это выброшенные деньги на LLM/TTS, а сохраняем мы только целые.
async function forEachChunk(
  chunks: ChunkRow[],
  concurrency: number,
  deadline: number,
  handler: (c: ChunkRow) => Promise<void>,
  job: JobRow,
): Promise<void> {
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      if (Date.now() >= deadline) return;
      const i = next++;
      if (i >= chunks.length) return;
      const c = chunks[i];
      try {
        await handler(c);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const attempts = await markChunkFailed({
          jobId: job.id,
          idx: c.idx,
          message,
        });
        // Пока попытки не исчерпаны — не роняем job: остальные чанки
        // доработают, а этот повторится на следующем тике.
        if (attempts >= MAX_CHUNK_ATTEMPTS) {
          throw new Error(`фрагмент ${c.idx + 1}: ${message}`);
        }
        await logError({
          level: "warn",
          source: "server",
          route: "/api/cron/process-jobs",
          message,
          stack: err instanceof Error ? err.stack ?? null : null,
          meta: { job_id: job.id, chunk_idx: c.idx, attempts },
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker()),
  );
}

// Группирует подряд идущие сегменты в чанки для перевода и TTS. Работаем
// с исходным текстом — перевод придёт поверх готового чанка одной строкой,
// и тот же чанк станет одной строкой транскрипта в UI.
interface SourceChunk {
  start_ms: number;
  end_ms: number;
  source_text: string;
}

const CHUNK_MAX_MS = 180_000;
const BREAK_GAP_MS = 1_000;

function chunkSourceSegments(segments: SegmentInput[]): SourceChunk[] {
  const chunks: SourceChunk[] = [];
  let current: SourceChunk | null = null;

  for (const s of segments) {
    const text = (s.text || "").trim();
    if (!current) {
      current = { start_ms: s.start_ms, end_ms: s.end_ms, source_text: text };
      continue;
    }
    const gap = s.start_ms - current.end_ms;
    const wouldBeDuration = s.end_ms - current.start_ms;
    if (gap > BREAK_GAP_MS || wouldBeDuration > CHUNK_MAX_MS) {
      chunks.push(current);
      current = { start_ms: s.start_ms, end_ms: s.end_ms, source_text: text };
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
