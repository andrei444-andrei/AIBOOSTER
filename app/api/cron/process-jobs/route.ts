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
  // Auth: если CRON_SECRET задан в env — проверяем Bearer, Vercel cron
  // его автоматически добавит. Если не задан — endpoint открыт, и его
  // могут дёргать Vercel cron, я сам curl'ом для debug или кто угодно
  // снаружи. Это персональный проект — внешний вызов = бесплатное
  // выполнение нашей же работы (process queued job), вреда нет.
  // Раньше блокировали по ADMIN_TOKEN как fallback — но Vercel cron его
  // не знает и шлёт без header'а, ловил 401 на каждом тике.
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${expected}`) {
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
