import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { getSession, getTurns, type Suggestion } from "@/lib/live-dialogue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/live-dialogue/[id] — сессия + лог реплик (для просмотра ошибок/верных).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    const session = await getSession(id);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
    const turns = await getTurns(id);
    return NextResponse.json({
      session: {
        id: session.id,
        topic: session.topic,
        status: session.status,
        turn_count: session.turn_count,
        ok_count: session.ok_count,
        error_count: session.error_count,
        current_question: session.current_question,
        current_suggestion: parseSuggestion(session.current_suggestion),
        goal_ru: session.goal_ru,
        beats_total: beatsTotal(session.beats_json),
        beats_done: session.beats_done ?? 0,
        ended_reason: session.ended_reason,
        created_at: session.created_at,
        finished_at: session.finished_at,
      },
      turns: turns.map((t) => ({
        idx: t.idx,
        ai_text: t.ai_text,
        user_transcript: t.user_transcript,
        verdict: t.verdict,
        error_reason: t.error_reason,
        correction: t.correction,
        created_at: t.created_at,
      })),
    });
  } catch (err) {
    const error_id = await logServerError(err, `/api/live-dialogue/${id}`);
    return NextResponse.json({ error: "не удалось прочитать сессию", error_id }, { status: 500 });
  }
}

function parseSuggestion(raw: string | null): Suggestion | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return { en: typeof o?.en === "string" ? o.en : "", ru: typeof o?.ru === "string" ? o.ru : "" };
  } catch {
    return null;
  }
}

function beatsTotal(raw: string | null): number {
  if (!raw) return 0;
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.length : 0;
  } catch {
    return 0;
  }
}
