import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { transcribeAudio } from "@/lib/ai";
import { getSession, processAnswer, STT_MODEL } from "@/lib/live-dialogue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// POST /api/live-dialogue/[id]/answer — multipart { audio }.
// STT → оценка → продолжение / коррекция / повтор. Возвращает исход с аудио.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad form-data" }, { status: 400 });
  }
  const audioRaw = formData.get("audio");
  if (!(audioRaw instanceof Blob) || audioRaw.size === 0) {
    return NextResponse.json({ error: "поле audio обязательно" }, { status: 400 });
  }
  if (audioRaw.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "аудио слишком большое" }, { status: 413 });
  }

  try {
    const session = await getSession(id);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
    if (session.status !== "active") {
      return NextResponse.json({ error: "сессия завершена" }, { status: 409 });
    }

    let transcript = "";
    try {
      const r = await transcribeAudio({
        audio: audioRaw,
        filename: `answer.${extFor(audioRaw.type)}`,
        language: "en",
        model: STT_MODEL,
      });
      transcript = r.text ?? "";
    } catch {
      // STT упал/тихо — просим повторить, не валим запрос.
      transcript = "";
    }

    const outcome = await processAnswer(session, transcript);
    return NextResponse.json(outcome);
  } catch (err) {
    const error_id = await logServerError(err, `/api/live-dialogue/${id}/answer`);
    return NextResponse.json({ error: "не удалось обработать ответ", error_id }, { status: 500 });
  }
}

function extFor(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac") || m.includes("x-m4a")) return "m4a";
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  return "webm";
}
