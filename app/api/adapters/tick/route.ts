import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { listDueSources } from "@/lib/adapters/sources";
import { enqueueJob } from "@/lib/adapters/sync-jobs";
import { logServerError } from "@/lib/logger";
import { checkAdminToken } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET/POST /api/adapters/tick
//
// Entry point для Vercel Cron (vercel.json → "schedule": "* * * * *").
// Идёт по списку due-источников и для каждого ставит pull-job в очередь
// (с дедупом — если активный job уже есть, новый не создаётся).
//
// Авторизация — любая из:
//   1) Vercel Cron шлёт `Authorization: Bearer <CRON_SECRET>`
//      (env CRON_SECRET задан в Vercel — настраивается там же)
//   2) Ручной вызов с ADMIN_TOKEN (через любой из способов в lib/auth.ts).
//
// Если ни CRON_SECRET, ни ADMIN_TOKEN не сконфигурены — fail-closed (503).

async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const due = await listDueSources();
    const queued: { source_id: string; job_id: string }[] = [];
    for (const src of due) {
      const job = await enqueueJob({ sourceId: src.id, kind: src.kind, jobKind: "pull" });
      queued.push({ source_id: src.id, job_id: job.id });
    }
    return NextResponse.json({ ok: true, considered: due.length, queued });
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
