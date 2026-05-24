import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { listDueSources } from "@/lib/adapters/sources";
import { enqueueJob } from "@/lib/adapters/sync-jobs";
import { runJobs } from "@/lib/adapters/runner";
import { logServerError } from "@/lib/logger";
import { checkAdminToken } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Vercel: разрешаем держать функцию до 60 секунд (Pro). На hobby лимит 10с
// проигнорируется — функция всё равно убьётся через 10с, но runJobs пишет
// «зависшие» job'ы как stale и подбирает их со следующего вызова.
export const maxDuration = 60;

// GET/POST /api/adapters/tick
//
// Entry point для Vercel Cron (vercel.json → "schedule": "* * * * *").
// Делает два шага:
//   1. enqueue: для каждого due-источника ставит pull-job (с дедупом).
//   2. runJobs: inline-исполнитель — забирает job'ы из очереди и прогоняет
//      их через зарегистрированный адаптер до окончания тайм-бюджета.
//
// Когда какой-то источник перестанет укладываться в окно — выделим
// внешний воркер и переключим tick обратно на чистый enqueue.
//
// Авторизация — любая из:
//   1) Vercel Cron шлёт `Authorization: Bearer <CRON_SECRET>`.
//   2) Ручной вызов с ADMIN_TOKEN (через любой из способов в lib/auth.ts).

async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const due = await listDueSources();
    const queued: { source_id: string; job_id: string }[] = [];
    for (const src of due) {
      const job = await enqueueJob({ sourceId: src.id, kind: src.kind, jobKind: "pull" });
      queued.push({ source_id: src.id, job_id: job.id });
    }

    // Прогоняем сколько успеем за оставшийся бюджет.
    const elapsed = Date.now() - startedAt;
    const budget = Math.max(5000, 55_000 - elapsed);
    const ran = await runJobs({
      workerId: "tick-inline",
      budgetMs: budget,
    });

    return NextResponse.json({
      ok: true,
      considered: due.length,
      queued,
      ran: ran.processed,
      job_ids: ran.jobIds,
      took_ms: Date.now() - startedAt,
    });
  } catch (err) {
    const error_id = await logServerError(err, "/api/adapters/tick");
    return NextResponse.json({ error: "tick failed", error_id }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;

function isAuthorized(req: Request): boolean {
  // Vercel Cron path: проверяем CRON_SECRET, если он задан.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    const provided =
      auth && auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    if (provided && constantTimeEqual(provided, cronSecret)) return true;
  }
  // Ручной/админский путь.
  const adminCheck = checkAdminToken(req);
  return adminCheck.ok;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
