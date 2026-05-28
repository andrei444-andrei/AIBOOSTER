// Vercel Cron: каждую минуту забирает по одной queued-job и прогоняет
// пайплайн (Apify → translate → TTS → mux → R2). Заменяет внешний worker —
// больше не нужен отдельный контейнер на Railway/Fly.
//
// Аутентификация: Vercel автоматически отправляет Bearer-токен с CRON_SECRET,
// мы его проверяем. См. https://vercel.com/docs/cron-jobs/manage-cron-jobs

import { NextResponse } from "next/server";
import { claimNextJob } from "@/lib/jobs";
import { runJob } from "@/lib/pipeline/run";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // 5 минут (Pro план)

const WORKER_ID = "vercel-cron";

export async function GET(req: Request) {
  // Проверка авторизации:
  // 1. Vercel Cron автоматически добавляет header `x-vercel-cron: 1` —
  //    пропускаем без bearer-токена. Если CRON_SECRET не задан, Vercel
  //    больше ничего не шлёт, поэтому именно этот header — единственный
  //    надёжный признак родного крона.
  // 2. Ручной запуск из curl/MCP — Bearer ADMIN_TOKEN / CRON_SECRET.
  const isVercelCron = req.headers.get("x-vercel-cron") !== null;
  if (!isVercelCron) {
    const auth = req.headers.get("authorization") || "";
    const expected = process.env.CRON_SECRET || process.env.ADMIN_TOKEN || "";
    if (expected && auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let job;
  try {
    job = await claimNextJob(WORKER_ID);
  } catch (err) {
    const error_id = await logServerError(err, "/api/cron/process-jobs", {
      phase: "claim",
    });
    return NextResponse.json({ error: "claim failed", error_id }, { status: 500 });
  }

  if (!job) return NextResponse.json({ ok: true, picked: false });

  // runJob сам ловит свои ошибки и пишет в app_errors через markJobError.
  await runJob(job);
  return NextResponse.json({ ok: true, picked: true, job_id: job.id });
}
