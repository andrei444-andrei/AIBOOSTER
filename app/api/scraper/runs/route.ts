import { NextResponse } from "next/server";
import { listRecentRuns } from "@/lib/scraper/orchestrator";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/scraper/runs?limit=N
 * Список последних запусков для главной модуля.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = clamp(limitRaw ? parseInt(limitRaw, 10) : 20, 1, 100);

  try {
    const runs = await listRecentRuns(limit);
    return NextResponse.json({ count: runs.length, runs });
  } catch (err) {
    const errorId = await logServerError(err, "/api/scraper/runs");
    return NextResponse.json(
      {
        error: {
          message: err instanceof Error ? err.message : "Ошибка чтения списка",
          error_id: errorId,
        },
      },
      { status: 500 },
    );
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(n, lo), hi);
}
