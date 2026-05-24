import { NextResponse } from "next/server";
import { checkWorkerSecret } from "@/lib/worker-auth";
import { logServerError } from "@/lib/logger";
import { claimNextSyncJob } from "@/lib/adapters/sync-jobs";
import { getSource, setSourceStatus, parseJsonField } from "@/lib/adapters/sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/adapters/claim
// Body: { worker_id?: string }
//
// Воркер забирает один adapter_sync_job (queued или зависший running).
// Вместе с job-ом возвращает credentials и текущий cursor источника —
// чтобы воркер не делал второй запрос. Источник переводится в status='syncing'.
//
// Если очередь пуста — возвращает { job: null }.
export async function POST(req: Request) {
  const auth = checkWorkerSecret(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Пустое тело допустимо.
  }
  const workerId =
    typeof body.worker_id === "string" && body.worker_id ? body.worker_id : "unknown";

  try {
    const job = await claimNextSyncJob(workerId);
    if (!job) return NextResponse.json({ job: null });

    const src = await getSource(job.source_id);
    if (!src) {
      // Источник удалили после постановки job'а — отдаём минимальную инфу,
      // пусть воркер пометит job ошибкой через /api/adapters/update.
      return NextResponse.json({
        job: {
          id: job.id,
          source_id: job.source_id,
          kind: job.kind,
          job_kind: job.job_kind,
          credentials: null,
          cursor: null,
          source_missing: true,
        },
      });
    }

    // Помечаем источник как «синкается», чтобы admin/UI видели прогресс.
    await setSourceStatus(src.id, "syncing");

    return NextResponse.json({
      job: {
        id: job.id,
        source_id: src.id,
        kind: src.kind,
        job_kind: job.job_kind,
        display_name: src.display_name,
        credentials: parseJsonField(src.credentials),
        cursor: parseJsonField(src.cursor),
      },
    });
  } catch (err) {
    const error_id = await logServerError(err, "/api/adapters/claim", { workerId });
    return NextResponse.json({ error: "claim failed", error_id }, { status: 500 });
  }
}
