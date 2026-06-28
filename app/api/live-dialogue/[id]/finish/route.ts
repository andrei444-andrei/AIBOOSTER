import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { getSession, finishSession } from "@/lib/live-dialogue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/live-dialogue/[id]/finish — завершить сессию, вернуть итог.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    const session = await getSession(id);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
    if (session.status !== "finished") await finishSession(id);
    return NextResponse.json({
      ok: true,
      summary: {
        turn_count: session.turn_count,
        ok_count: session.ok_count,
        error_count: session.error_count,
      },
    });
  } catch (err) {
    const error_id = await logServerError(err, `/api/live-dialogue/${id}/finish`);
    return NextResponse.json({ error: "не удалось завершить сессию", error_id }, { status: 500 });
  }
}
