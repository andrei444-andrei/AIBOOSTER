import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { synthSpeech } from "@/lib/live-dialogue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/live-dialogue/speak — { text } → { audio: data-URI }.
// Озвучка произвольной фразы: для кнопки «Помощь» и для продолжения
// (резюма) сессии (текущий вопрос аудио не хранится).
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  if (text.length > 800) return NextResponse.json({ error: "too long" }, { status: 400 });
  try {
    const audio = await synthSpeech(text);
    return NextResponse.json({ audio });
  } catch (err) {
    const error_id = await logServerError(err, "/api/live-dialogue/speak");
    return NextResponse.json({ error: "tts failed", error_id }, { status: 500 });
  }
}
