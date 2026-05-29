// Голосовой ввод: транскрипция аудио → текст. Используется кнопкой-микрофоном
// в композере чата.
//
// Контракт:
//   POST /api/transcribe
//   Content-Type: multipart/form-data
//   fields:
//     audio:     File   — обязательное, до 25 МБ (webm/wav/mp3/m4a/ogg/...)
//     language?: string — ISO-639-1 (ru/en/...), подсказка модели
//     prompt?:   string — подсказка контекста (имена, термины), до 244 токенов
//
//   200: { text: string, language?: string, duration?: number }
//   4xx/5xx: { error: { code, message, error_id } }
//
// Идёт через OpenAI direct (gpt-4o-transcribe), НЕ через AIMLAPI —
// AIMLAPI не поддерживает /v1/audio/transcriptions. Это исключение к §4
// конституции, явно одобренное владельцем.

import { transcribeAudio, AIError } from "@/lib/ai";
import { logServerError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 МБ — лимит OpenAI Audio API.
const ALLOWED_MIME_PREFIXES = ["audio/", "video/webm"]; // video/webm бывает у MediaRecorder.

export async function POST(req: Request) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    const error_id = await logServerError(err, "/api/transcribe", { phase: "parse_form" });
    return Response.json(
      { error: { code: "bad_form", message: "Не удалось прочитать форму", error_id } },
      { status: 400 },
    );
  }

  const audioRaw = formData.get("audio");
  if (!(audioRaw instanceof Blob)) {
    return Response.json(
      { error: { code: "missing_audio", message: "Поле audio обязательно" } },
      { status: 400 },
    );
  }
  const audio = audioRaw as Blob & { name?: string };
  if (audio.size === 0) {
    return Response.json(
      { error: { code: "empty_audio", message: "Аудио-файл пустой" } },
      { status: 400 },
    );
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json(
      { error: { code: "too_large", message: `Аудио больше ${MAX_AUDIO_BYTES} байт` } },
      { status: 413 },
    );
  }
  const mime = audio.type || "";
  if (mime && !ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p))) {
    return Response.json(
      { error: { code: "bad_mime", message: `Неподдерживаемый MIME: ${mime}` } },
      { status: 415 },
    );
  }

  const language = typeof formData.get("language") === "string" ? (formData.get("language") as string) : undefined;
  const prompt = typeof formData.get("prompt") === "string" ? (formData.get("prompt") as string) : undefined;

  // OpenAI/Whisper требуют расширение в имени файла для распознавания формата.
  const ext = mimeToExt(mime);
  const filename = audio.name && audio.name.includes(".") ? audio.name : `voice.${ext}`;

  try {
    const result = await transcribeAudio({
      audio,
      filename,
      language: language && language.length <= 5 ? language : undefined,
      prompt: prompt && prompt.length <= 500 ? prompt : undefined,
    });
    return Response.json(result);
  } catch (err) {
    let message = "Транскрипция не удалась";
    let status = 502;
    if (err instanceof AIError) {
      message = err.message;
      // OpenAI 401 значит сломанный/отсутствующий ключ — наружу пробрасываем как 503.
      status = err.status === 401 ? 503 : err.status;
    } else if (err instanceof Error) {
      message = err.message;
    }
    const error_id = await logServerError(err, "/api/transcribe", {
      mime,
      size: audio.size,
      language,
    });
    return Response.json(
      { error: { code: "transcribe_failed", message, error_id } },
      { status },
    );
  }
}

function mimeToExt(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("wav") || mime.includes("wave")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
  return "webm";
}
