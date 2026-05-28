import { NextResponse } from "next/server";
import { checkWorkerSecret } from "@/lib/worker-auth";
import { logServerError } from "@/lib/logger";
import { claimNextJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/worker/claim
// Body: { worker_id: string }
// Воркер атомарно забирает одну job из очереди (или возвращает null).
// Также подбирает зависшие running-job (claimed_at > 30 мин назад).
export async function POST(req: Request) {
  const auth = checkWorkerSecret(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Пустое тело допустимо — worker_id опциональный.
  }
  const workerId = typeof body.worker_id === "string" && body.worker_id ? body.worker_id : "unknown";

  try {
    const job = await claimNextJob(workerId);
    if (!job) return NextResponse.json({ job: null });
    return NextResponse.json({
      job: {
        id: job.id,
        url: job.yt_url,
        video_id: job.yt_video_id,
        target_lang: job.target_lang,
        quality: job.quality,
      },
    });
  } catch (err) {
    const error_id = await logServerError(err, "/api/worker/claim", { workerId });
    return NextResponse.json({ error: "claim failed", error_id }, { status: 500 });
  }
}
