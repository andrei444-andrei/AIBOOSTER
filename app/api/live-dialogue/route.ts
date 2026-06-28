import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { startSession, listSessions } from "@/lib/live-dialogue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/live-dialogue?status=active|finished|all — список сессий.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const s = url.searchParams.get("status");
  const status = s === "active" || s === "finished" ? s : "all";
  try {
    const sessions = await listSessions(status);
    return NextResponse.json({ sessions });
  } catch (err) {
    const error_id = await logServerError(err, "/api/live-dialogue");
    return NextResponse.json({ error: "не удалось прочитать список", error_id }, { status: 500 });
  }
}

// POST /api/live-dialogue — { topic }. Создаёт сессию, генерит первый вопрос и
// озвучивает. Возвращает { session_id, ai_text, ai_audio (data-URI), suggestion }.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) return NextResponse.json({ error: "укажи тему разговора" }, { status: 400 });
  if (topic.length > 1000) {
    return NextResponse.json({ error: "тема слишком длинная" }, { status: 400 });
  }

  try {
    const { session, aiText, aiAudio, suggestion } = await startSession(topic);
    return NextResponse.json({
      session_id: session.id,
      ai_text: aiText,
      ai_audio: aiAudio,
      suggestion,
    });
  } catch (err) {
    const error_id = await logServerError(err, "/api/live-dialogue", { topic });
    return NextResponse.json({ error: "не удалось начать диалог", error_id }, { status: 500 });
  }
}
