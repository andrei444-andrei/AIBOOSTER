import { checkAdminToken } from "@/lib/auth";
import { tickRun } from "@/lib/research/engine";
import { logServerError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/research/tick?run=<id>&n=<maxTicks>
// Ручное продвижение прогона (для отладки и тестов без ожидания cron). Под admin-токеном.
export async function POST(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status });
  }

  const url = new URL(req.url);
  const runId = url.searchParams.get("run");
  if (!runId) {
    return Response.json({ error: "query param 'run' is required" }, { status: 400 });
  }
  const n = clampInt(url.searchParams.get("n"), 1, 50, 12);

  try {
    // Оставляем запас до таймаута функции (maxDuration=60s).
    const deadline = Date.now() + 50_000;
    const result = await tickRun(runId, n, deadline);
    return Response.json(result);
  } catch (err) {
    const errorId = await logServerError(err, "/api/research/tick", { runId });
    return Response.json(
      { error: "tick failed", error_id: errorId },
      { status: 500 },
    );
  }
}

function clampInt(v: string | null, lo: number, hi: number, d: number): number {
  const n = parseInt(v ?? "", 10);
  if (!Number.isFinite(n)) return d;
  return Math.min(Math.max(n, lo), hi);
}
