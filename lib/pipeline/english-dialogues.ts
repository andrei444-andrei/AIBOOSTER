// Пайплайн генерации англоязычного разговора для практики языка.
//
// Этапы (с прогрессом для UI):
//   script (0..25)  — LLM пишет сценарий по теме: реплики на английском + их
//                     русский перевод, с разбивкой на говорящих (диалог) или
//                     одного спикера (монолог). Генерация идёт в цикле «дописывания»
//                     до тех пор, пока расчётная длительность не дотянет до
//                     запрошенных минут (LLM за один заход систематически
//                     недодаёт объём — добираем продолжением разговора).
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

// Калибровка длительности (по реальным замерам ElevenLabs eleven_multilingual_v2:
// чистая речь ~163 слов/мин). Берём 170 — слегка завышаем темп, чтобы оценка
// чуть НЕдооценивала длительность и цикл добирал контент с запасом (лучше
// немного длиннее запрошенного, чем короче). Оценка воспроизводит реальные
// замеры в пределах ~4%.
const SPEECH_WPM = 170;

const TTS_CONCURRENCY = 5;

// Циклы «дописывания» сценария и потолок числа фраз (бюджет serverless-функции,
// maxDuration=300). С переводом на фразу 2 TTS-вызова, поэтому потолок ниже.
const MAX_FILL_ROUNDS = 6;
function maxSentences(withTranslation: boolean): number {
  return withTranslation ? 150 : 240;
}

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

  // 1. Сценарий — дописываем до запрошенной длительности.
  await updateDialogueProgress({ id: job.id, stage: "script", progress: 6 });
  const { title, lines } = await generateScript({
    topic: job.topic,
    durationMin: job.duration_min,
    kind,
    withTranslation,
    jobId: job.id,
  });
  await updateDialogueProgress({ id: job.id, stage: "script", progress: 24, title });
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

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Расчётная длительность готового аудио по словам (без TTS — дёшево).
// Воспроизводит реальные замеры в пределах ~4%, что достаточно для попадания
// в запрошенные минуты.
function estimateDurationSec(lines: Line[], withTranslation: boolean): number {
  let enWords = 0;
  let ruWords = 0;
  for (const ln of lines) {
    enWords += wordCount(ln.en);
    if (withTranslation && ln.ru) ruWords += wordCount(ln.ru);
  }
  const speechSec = ((enWords + ruWords) / SPEECH_WPM) * 60;
  const pauseSec =
    LEAD_MS / 1000 +
    (lines.length * ((withTranslation ? GAP_EN_RU_MS : 0) + GAP_LINE_MS)) / 1000;
  return speechSec + pauseSec;
}

// Сколько английских слов попросить, чтобы добрать ~secNeeded секунд аудио.
// Пауз в оценку не закладываем (они тоже наполняют время) — намеренно просим
// чуть меньше, цикл добьёт остаток.
function enWordsForSeconds(secNeeded: number, withTranslation: boolean): number {
  const totalWords = (secNeeded * SPEECH_WPM) / 60;
  const enWords = withTranslation ? totalWords / 1.85 : totalWords; // RU ≈ 0.85×EN
  return Math.max(40, Math.min(900, Math.round(enWords * 0.85)));
}

interface ScriptInput {
  topic: string;
  durationMin: number;
  kind: "dialogue" | "monologue";
  withTranslation: boolean;
  jobId: string;
}

// Генерация сценария с дописыванием до целевой длительности. LLM за один заход
// систематически недодаёт объём (и тем сильнее, чем больше просишь), поэтому
// генерим первый кусок, оцениваем длительность и добираем продолжением, пока
// не дотянем до запрошенных минут или не упрёмся в лимиты.
async function generateScript(
  input: ScriptInput,
): Promise<{ title: string; lines: Line[] }> {
  const targetSec = input.durationMin * 60;
  const cap = maxSentences(input.withTranslation);
  let title = "";
  const lines: Line[] = [];

  for (let round = 0; round < MAX_FILL_ROUNDS; round++) {
    const estSec = estimateDurationSec(lines, input.withTranslation);
    if (estSec >= targetSec * 0.97) break;
    if (lines.length >= cap) break;

    const askWords = enWordsForSeconds(targetSec - estSec, input.withTranslation);
    const { title: t, turns } =
      round === 0
        ? await generateInitialChunk(input, askWords)
        : await continueChunk(input, lines, askWords);

    if (round === 0 && t) title = t;
    const newLines = flattenTurns(turns);
    if (newLines.length === 0) {
      if (round === 0) throw new Error("LLM вернул пустой сценарий");
      break; // модель больше ничего осмысленного не даёт — выходим
    }
    for (const ln of newLines) {
      if (lines.length >= cap) break;
      lines.push(ln);
    }

    // Прогресс этапа script: 6→22 по мере набора длительности.
    const filled = Math.min(1, estimateDurationSec(lines, input.withTranslation) / targetSec);
    await updateDialogueProgress({
      id: input.jobId,
      stage: "script",
      progress: 6 + Math.round(16 * filled),
    });
  }

  if (!title) title = input.topic.slice(0, 80);

  // Модель на последнем «дописывании» обычно даёт чуть больше запрошенного —
  // срезаем хвост, чтобы не перебирать сверх ~5% над целевой длительностью.
  while (
    lines.length > 1 &&
    estimateDurationSec(lines, input.withTranslation) > targetSec * 1.05
  ) {
    lines.pop();
  }

  return { title, lines };
}

const SYSTEM_PROMPT =
  `Ты пишешь сценарии аудио для изучающих английский язык. ` +
  `Уровень A2–B2: ясные, естественные, не куцые предложения живым современным языком. ` +
  `Отвечай СТРОГО JSON-объектом без markdown по схеме:\n` +
  `{"title": string, "turns": [{"speaker": "A"|"B"|null, "sentences": [{"en": string, "ru": string}]}]}\n` +
  `Где "en" — естественное английское предложение, "ru" — его точный, живой русский перевод ` +
  `(не дословная калька). "title" — короткий заголовок на английском (до 6 слов). ` +
  `Каждое предложение — отдельный элемент массива sentences (не склеивай несколько в одно). ` +
  `Пиши содержательно и подробно, раскрывай тему — объём важен. Никакого текста вне JSON.`;

async function generateInitialChunk(
  input: ScriptInput,
  askWords: number,
): Promise<{ title: string | null; turns: Turn[] }> {
  const form =
    input.kind === "dialogue"
      ? `Напиши живой ДИАЛОГ двух собеседников с метками "A" и "B" (чередуются) — естественный разговор по теме с вопросами и ответами.`
      : `Напиши МОНОЛОГ одного говорящего по теме (рассказ/объяснение). Для всех реплик speaker = null.`;
  const user =
    `${form}\n\n` +
    `Тема: "${input.topic}".\n` +
    `Это аудио должно звучать примерно ${input.durationMin} мин, поэтому нужно МНОГО реплик. ` +
    `Дай не меньше ${Math.round(askWords)} английских слов, разбитых на естественные предложения ` +
    `(это ~${Math.max(8, Math.round(askWords / 9))} предложений). Не сворачивай тему раньше времени. ` +
    `Верни только JSON-объект.`;

  const { parsed } = await chatJson<unknown>({
    model: process.env.AIMLAPI_CHAT_MODEL || "gpt-4o",
    system: SYSTEM_PROMPT,
    user,
    temperature: 0.8,
    maxTokens: 8000,
    timeoutMs: 120_000,
  });
  return { title: parseTitle(parsed), turns: parseTurns(parsed) };
}

async function continueChunk(
  input: ScriptInput,
  existing: Line[],
  askWords: number,
): Promise<{ title: string | null; turns: Turn[] }> {
  // Контекст — последние реплики, чтобы продолжение было связным и без повторов.
  const tail = existing
    .slice(-6)
    .map((l) => (l.speaker ? `[${l.speaker}] ${l.en}` : l.en))
    .join("\n");
  const form =
    input.kind === "dialogue"
      ? `Продолжи ДИАЛОГ теми же собеседниками "A" и "B".`
      : `Продолжи МОНОЛОГ того же говорящего (speaker = null).`;
  const user =
    `${form} Тема: "${input.topic}".\n` +
    `Вот последние реплики разговора:\n${tail}\n\n` +
    `Продолжи естественно и БЕЗ ПОВТОРОВ, развивая тему дальше (новые подтемы, детали, примеры). ` +
    `Добавь примерно ${Math.round(askWords)} английских слов отдельными предложениями. ` +
    `"title" можно не указывать. Верни только JSON-объект того же формата (turns).`;

  const { parsed } = await chatJson<unknown>({
    model: process.env.AIMLAPI_CHAT_MODEL || "gpt-4o",
    system: SYSTEM_PROMPT,
    user,
    temperature: 0.85,
    maxTokens: 6000,
    timeoutMs: 120_000,
  });
  return { title: parseTitle(parsed), turns: parseTurns(parsed) };
}

function flattenTurns(turns: Turn[]): Line[] {
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

function parseTitle(parsed: unknown): string | null {
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  return typeof obj.title === "string" && obj.title.trim()
    ? obj.title.trim().slice(0, 120)
    : null;
}

// Терпимый разбор реплик. Допускаем разные формы (turns/dialogue/lines,
// speaker строкой/числом/null). Возвращает [] если ничего не разобралось.
function parseTurns(parsed: unknown): Turn[] {
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
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
  return turns;
}

function normalizeSpeaker(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  if (!s || s === "NULL" || s === "NARRATOR") return null;
  return s.slice(0, 1) === "B" ? "B" : "A";
}

function normalizeSentences(raw: unknown): Sentence[] {
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
  if (typeof raw === "string" && raw.trim()) {
    return [{ en: raw.trim(), ru: "" }];
  }
  return [];
}
