// Пайплайн генерации англоязычного разговора для практики языка.
//
// Этапы (с прогрессом для UI):
//   script (0..25)  — LLM пишет сценарий по теме: реплики на английском + их
//                     русский перевод, с разбивкой на говорящих (диалог) или
//                     одного спикера (монолог).
//   tts    (25..80) — ElevenLabs озвучивает каждую фразу. При with_translation
//                     после английского предложения идёт его русский перевод
//                     (отдельным голосом, чтобы перевод был слышно как перевод).
//   mux    (80..100)— ffmpeg склеивает все фразы в один mp3 с паузами, грузим в R2.
//
// Переиспользует инфраструктуру модуля youtube-translate: chatJson (LLM),
// ttsSynth (ElevenLabs через aimlapi), ffmpeg-обёртки и uploadMp3 (R2).

import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatJson } from "@/lib/aimlapi";
import { logError } from "@/lib/logger";
import {
  markDialogueDone,
  markDialogueError,
  replaceDialogueSegments,
  updateDialogueProgress,
  type DialogueJobRow,
} from "@/lib/english-dialogues";
import { ttsSynth } from "./aimlapi";
import { ffmpegConcatTimed, ffmpegNormalize, ffprobeDuration } from "./ffmpeg";
import { uploadMp3 } from "./storage";

// Голоса ElevenLabs. Для диалога два контрастных голоса (A — мужской,
// B — женский). Монолог читает A. Русский перевод — отдельным голосом, чтобы
// на слух было понятно «это перевод», а не продолжение реплики.
const VOICE_A = "Adam"; // первый говорящий / монолог
const VOICE_B = "Rachel"; // второй говорящий
const RU_VOICE = "Bella"; // голос русского перевода

// Паузы для комфортного восприятия учащимся (миллисекунды).
const LEAD_MS = 300; // тишина в самом начале
const GAP_EN_RU_MS = 350; // между английской фразой и её переводом
const GAP_LINE_MS = 550; // между фразами

// Сколько фраз максимум синтезировать — чтобы пайплайн уложился в бюджет
// serverless-функции (maxDuration=300). С переводом на фразу 2 TTS-вызова,
// поэтому при with_translation лимит фраз вдвое меньше.
const MAX_PIECES = 140;
const TTS_CONCURRENCY = 4;

interface Sentence {
  en: string;
  ru: string;
}
interface Turn {
  speaker: string | null;
  sentences: Sentence[];
}
interface Line {
  speaker: string | null;
  en: string;
  ru: string;
}

export async function runDialogueJob(job: DialogueJobRow): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), `endlg-${job.id}-`));
  try {
    await runPipeline(job, work);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const errorId = await logError({
      level: "error",
      source: "server",
      route: "/api/cron/process-english",
      message,
      stack: stack ?? null,
      meta: { job_id: job.id, topic: job.topic },
    });
    await markDialogueError({ id: job.id, message, errorId });
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

async function runPipeline(job: DialogueJobRow, work: string): Promise<void> {
  const withTranslation = job.with_translation === 1;
  const kind = job.kind === "monologue" ? "monologue" : "dialogue";

  // 1. Сценарий.
  await updateDialogueProgress({ id: job.id, stage: "script", progress: 6 });
  const { title, turns } = await generateScript({
    topic: job.topic,
    durationMin: job.duration_min,
    kind,
    withTranslation,
  });
  await updateDialogueProgress({ id: job.id, stage: "script", progress: 24, title });

  // Разворачиваем реплики в плоский список фраз и режем под лимит.
  const maxLines = withTranslation ? Math.floor(MAX_PIECES / 2) : MAX_PIECES;
  const lines = flattenLines(turns).slice(0, maxLines);
  if (lines.length === 0) throw new Error("сценарий пустой — не из чего озвучивать");

  // 2. Озвучка каждой фразы (и перевода). Файлы генерим параллельно.
  await updateDialogueProgress({ id: job.id, stage: "tts", progress: 28 });
  interface Clip {
    lineIdx: number;
    lang: "en" | "ru";
    text: string;
    voice: string;
    file: string;
  }
  const clips: Clip[] = [];
  lines.forEach((ln, i) => {
    clips.push({
      lineIdx: i,
      lang: "en",
      text: ln.en,
      voice: voiceForSpeaker(kind, ln.speaker),
      file: join(work, `l${i}-en.mp3`),
    });
    if (withTranslation && ln.ru) {
      clips.push({
        lineIdx: i,
        lang: "ru",
        text: ln.ru,
        voice: RU_VOICE,
        file: join(work, `l${i}-ru.mp3`),
      });
    }
  });

  let nextIdx = 0;
  let done = 0;
  let lastReportAt = 0;
  async function reportTts() {
    if (Date.now() - lastReportAt < 1500) return;
    lastReportAt = Date.now();
    const p = 28 + Math.round((52 * done) / clips.length);
    await updateDialogueProgress({ id: job.id, stage: "tts", progress: Math.min(p, 80) });
  }
  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIdx++;
      if (i >= clips.length) return;
      const c = clips[i];
      const raw = await ttsSynth(c.text, { voice: c.voice });
      const rawFile = `${c.file}.raw`;
      await writeFile(rawFile, raw);
      // Нормализуем в канонический формат (44.1kHz mono) — без этого concat
      // demuxer спотыкается на разных частотах от ElevenLabs.
      await ffmpegNormalize(rawFile, c.file);
      done++;
      await reportTts();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(TTS_CONCURRENCY, clips.length) }, () => worker()),
  );

  // 3. Сборка таймлайна: позиционируем клипы с паузами. ffmpegConcatTimed сам
  // вставит тишину в промежутках (между EN и RU, между фразами, в начале).
  await updateDialogueProgress({ id: job.id, stage: "mux", progress: 84 });
  const byLine = new Map<number, { en?: string; ru?: string }>();
  for (const c of clips) {
    const e = byLine.get(c.lineIdx) ?? {};
    e[c.lang] = c.file;
    byLine.set(c.lineIdx, e);
  }

  const concatPieces: Array<{ file: string; start_ms: number; end_ms: number }> = [];
  const segments: Array<{
    idx: number;
    start_ms: number;
    end_ms: number;
    speaker: string | null;
    en_text: string;
    ru_text: string | null;
  }> = [];

  let cursor = LEAD_MS;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const files = byLine.get(i);
    if (!files?.en) continue;

    const enStart = cursor;
    const enDurMs = Math.round((await ffprobeDuration(files.en)) * 1000);
    const enEnd = enStart + enDurMs;
    concatPieces.push({ file: files.en, start_ms: enStart, end_ms: enEnd });
    cursor = enEnd;
    let lineEnd = enEnd;

    if (withTranslation && files.ru) {
      const ruStart = cursor + GAP_EN_RU_MS;
      const ruDurMs = Math.round((await ffprobeDuration(files.ru)) * 1000);
      const ruEnd = ruStart + ruDurMs;
      concatPieces.push({ file: files.ru, start_ms: ruStart, end_ms: ruEnd });
      cursor = ruEnd;
      lineEnd = ruEnd;
    }

    segments.push({
      idx: i,
      start_ms: enStart,
      end_ms: lineEnd,
      speaker: ln.speaker,
      en_text: ln.en,
      ru_text: withTranslation ? ln.ru || null : null,
    });
    cursor = lineEnd + GAP_LINE_MS;
  }

  await replaceDialogueSegments(job.id, segments);

  // 4. Склейка в один mp3.
  await updateDialogueProgress({ id: job.id, stage: "mux", progress: 90 });
  const finalMp3 = join(work, "final.mp3");
  await ffmpegConcatTimed(concatPieces, finalMp3, null);
  const durationSec = await ffprobeDuration(finalMp3).catch(() => null);

  // 5. Загрузка в R2.
  await updateDialogueProgress({ id: job.id, stage: "mux", progress: 96 });
  const data = await readFile(finalMp3);
  const key = `english-dialogues/${job.id}.mp3`;
  const audioUrl = await uploadMp3(key, data);

  await markDialogueDone({ id: job.id, audioUrl, durationSec });
}

function voiceForSpeaker(kind: "dialogue" | "monologue", speaker: string | null): string {
  if (kind === "monologue") return VOICE_A;
  return speaker === "B" ? VOICE_B : VOICE_A;
}

// Плоский список фраз из реплик. Каждое предложение реплики становится
// отдельной строкой (нужно для покадрового чередования EN→RU и подсветки).
function flattenLines(turns: Turn[]): Line[] {
  const lines: Line[] = [];
  for (const t of turns) {
    for (const s of t.sentences) {
      const en = s.en.trim();
      if (!en) continue;
      lines.push({ speaker: t.speaker, en, ru: (s.ru ?? "").trim() });
    }
  }
  return lines;
}

interface ScriptInput {
  topic: string;
  durationMin: number;
  kind: "dialogue" | "monologue";
  withTranslation: boolean;
}

async function generateScript(
  input: ScriptInput,
): Promise<{ title: string; turns: Turn[] }> {
  // Грубая оценка объёма: ElevenLabs читает ~150 слов/мин. С переводом
  // итоговое аудио = английский + русский, поэтому английского текста надо
  // примерно вдвое меньше под ту же длительность.
  const wordsTarget = Math.round(
    input.durationMin * (input.withTranslation ? 80 : 150),
  );

  const form =
    input.kind === "dialogue"
      ? `Напиши живой ДИАЛОГ двух собеседников с метками "A" и "B" (чередуются). ` +
        `Это естественный разговор по теме, с вопросами и ответами.`
      : `Напиши МОНОЛОГ одного говорящего по теме (рассказ/объяснение). ` +
        `Для всех реплик speaker = null.`;

  const system =
    `Ты пишешь сценарии аудио для изучающих английский язык. ` +
    `Уровень A2–B2: ясные, не слишком длинные предложения, живой современный язык. ` +
    `Отвечай СТРОГО JSON-объектом без markdown по схеме:\n` +
    `{"title": string, "turns": [{"speaker": "A"|"B"|null, "sentences": [{"en": string, "ru": string}]}]}\n` +
    `Где "en" — естественное английское предложение, "ru" — его точный, живой ` +
    `русский перевод (не дословная калька). "title" — короткий заголовок (на английском, до 6 слов). ` +
    `Каждое предложение — отдельный элемент массива sentences (не склеивай несколько в одно). ` +
    `Никакого текста вне JSON.`;

  const user =
    `${form}\n\n` +
    `Тема: "${input.topic}".\n` +
    `Объём английского текста — примерно ${wordsTarget} слов, разбей на естественные предложения. ` +
    `Верни только JSON-объект.`;

  const { parsed } = await chatJson<unknown>({
    model: process.env.AIMLAPI_CHAT_MODEL || "gpt-4o",
    system,
    user,
    temperature: 0.8,
    maxTokens: 8000,
    timeoutMs: 120_000,
  });

  return normalizeScript(parsed);
}

// Терпимый разбор ответа модели в {title, turns}. Допускаем разные формы
// (turns/dialogue/lines, speaker строкой/числом/null), пропускаем мусор.
function normalizeScript(parsed: unknown): { title: string; turns: Turn[] } {
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const title =
    typeof obj.title === "string" && obj.title.trim()
      ? obj.title.trim().slice(0, 120)
      : "English practice";

  const rawTurns = (obj.turns ?? obj.dialogue ?? obj.lines ?? obj.script) as unknown;
  const turns: Turn[] = [];
  if (Array.isArray(rawTurns)) {
    for (const t of rawTurns) {
      if (!t || typeof t !== "object") continue;
      const to = t as Record<string, unknown>;
      const speaker = normalizeSpeaker(to.speaker);
      const sentences = normalizeSentences(to.sentences ?? to.text ?? to.en);
      if (sentences.length) turns.push({ speaker, sentences });
    }
  }
  if (!turns.length) throw new Error("LLM вернул сценарий без реплик");
  return { title, turns };
}

function normalizeSpeaker(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  if (!s || s === "NULL" || s === "NARRATOR") return null;
  return s.slice(0, 1) === "B" ? "B" : "A";
}

function normalizeSentences(raw: unknown): Sentence[] {
  // Массив {en,ru}.
  if (Array.isArray(raw)) {
    const out: Sentence[] = [];
    for (const s of raw) {
      if (typeof s === "string") {
        if (s.trim()) out.push({ en: s.trim(), ru: "" });
        continue;
      }
      if (s && typeof s === "object") {
        const so = s as Record<string, unknown>;
        const en = typeof so.en === "string" ? so.en.trim() : "";
        const ru = typeof so.ru === "string" ? so.ru.trim() : "";
        if (en) out.push({ en, ru });
      }
    }
    return out;
  }
  // Одна строка целиком.
  if (typeof raw === "string" && raw.trim()) {
    return [{ en: raw.trim(), ru: "" }];
  }
  return [];
}
