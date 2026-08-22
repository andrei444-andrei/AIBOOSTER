import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { listRecentRuns, listActionsForRun } from "@/lib/maintenance-db";
import { listFailedOrArchivedItems } from "@/lib/news";
import { serializeItem } from "@/lib/news-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/news/agent-log
// Возвращает последние 30 audit-runs + список items в "ошибках" (failed
// enrichment ИЛИ archived).
export async function GET() {
  try {
    const runs = await listRecentRuns(30);
    // Тянем actions для последних 10 runs (для preview в UI).
    const runsWithActions = await Promise.all(
      runs.map(async (r, idx) => {
        const actions = idx < 10 ? await listActionsForRun(r.id) : [];
        return {
          id: r.id,
          started_at: r.started_at,
          finished_at: r.finished_at,
          status: r.status,
          summary: r.summary,
          agent_reasoning: r.agent_reasoning,
          cost_cents: r.cost_cents,
          latency_ms: r.latency_ms,
          error: r.error,
          actions: actions.map((a) => ({
            id: a.id,
            type: a.action_type,
            target_id: a.target_id,
            reason: a.reason,
            result: a.result,
            error: a.error,
            applied_at: a.applied_at,
          })),
        };
      }),
    );

    const errorItems = await listFailedOrArchivedItems(50);
    return NextResponse.json({
      runs: runsWithActions,
      error_items: errorItems.map(serializeItem),
    });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/agent-log");
    return NextResponse.json({ error: "failed", error_id }, { status: 500 });
  }
}
