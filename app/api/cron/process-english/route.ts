// Vercel Cron: забирает по одной queued-задаче генерации английского
// разговора и прогоняет пайплайн (script → TTS → mux → R2). Аналог
// /api/cron/process-jobs для youtube-translate.
//
// Аутентификация: если CRON_SECRET задан — проверяем Bearer (Vercel cron
// добавляет его сам). Если нет — открыт (персональный проект, внешний вызов
// лишь бесплатно выполняет нашу же работу).

import { NextResponse } from "next/server";
import { claimNextDialogueJob } from "@/lib/english-dialogues";
import { runDialogueJob } from "@/lib/pipeline/english-dialogues";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // 5 минут (Pro план)

const WORKER_ID = "vercel-cron-english";

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let job;
  try {
    job = await claimNextDialogueJob(WORKER_ID);
  } catch (err) {
    const error_id = await logServerError(err, "/api/cron/process-english", {
      phase: "claim",
    });
    return NextResponse.json({ error: "claim failed", error_id }, { status: 500 });
  }

  if (!job) return NextResponse.json({ ok: true, picked: false });

  // runDialogueJob сам ловит ошибки и пишет в app_errors через markDialogueError.
  await runDialogueJob(job);
  return NextResponse.json({ ok: true, picked: true, job_id: job.id });
}
