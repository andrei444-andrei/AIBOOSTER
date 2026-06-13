import { checkAdminToken } from "@/lib/auth";
import { tickRun } from "@/lib/research/engine";
import { listRunningRuns } from "@/lib/research/store";
import { logServerError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/research/cron
// Фоновый воркер: добивает все активные прогоны по чуть-чуть за вызов. Дёргается
// планировщиком Vercel Cron (см. vercel.json). Авторизация: либо CRON_SECRET в
// заголовке Authorization (его Vercel шлёт автоматически, если задан env), либо
// обычный admin-токен (для ручного дёрганья).
export async function GET(req: Request) {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const deadline = startedAt + 50_000; // запас до таймаута функции

  try {
    const runs = await listRunningRuns(20);
    const results: { id: string; ticks: number; done: boolean; note: string }[] = [];

    for (const run of runs) {
      if (Date.now() > deadline) break;
      // На один прогон за вызов выделяем ограниченную порцию тиков, чтобы успеть
      // продвинуть несколько прогонов параллельно во времени (round-robin).
      const r = await tickRun(run.id, 8, deadline);
      results.push({ id: run.id, ticks: r.ticks, done: r.done, note: r.lastNote });
    }

    return Response.json({
      processed: results.length,
      ms: Date.now() - startedAt,
      results,
    });
  } catch (err) {
    const errorId = await logServerError(err, "/api/research/cron");
    return Response.json({ error: "cron failed", error_id: errorId }, { status: 500 });
  }
}

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth && auth === `Bearer ${secret}`) return true;
  }
  return checkAdminToken(req).ok;
}
