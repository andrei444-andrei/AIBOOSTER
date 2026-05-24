import { NextResponse } from "next/server";
import { checkWorkerSecret } from "@/lib/worker-auth";
import { logError, logServerError } from "@/lib/logger";
import {
  finishSyncJob,
  getSyncJob,
  updateSyncJob,
} from "@/lib/adapters/sync-jobs";
import { markSourceError, scheduleNextRun } from "@/lib/adapters/sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/adapters/update
//
// Универсальный апдейт от воркера. Поля комбинируемые — воркер вызывает после
// каждого значимого шага.
//
// Body:
//   {
//     job_id: string,
//     progress?: number,         // 0..100
//     fetched_count?: number,
//     stats?: object,
//
//     // финальные состояния (взаимоисключающие)
//     done?: {
//       cursor?: unknown,        // новый cursor источника после успешного pull
//       fetched_count?: number,
//       stats?: object,
//     },
//     error?: {
//       message: string,
//       stack?: string,
//       meta?: unknown,
//       retry_after_sec?: number,  // через сколько разрешить новый sync
//     },
//   }
export async function POST(req: Request) {
  const auth = checkWorkerSecret(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const jobId = typeof body.job_id === "string" ? body.job_id : "";
  if (!jobId) {
    return NextResponse.json({ error: "job_id is required" }, { status: 400 });
  }

  try {
    const job = await getSyncJob(jobId);
    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

    // Прогресс / промежуточные показатели.
    const wantsProgress =
      body.progress !== undefined ||
      body.fetched_count !== undefined ||
      body.stats !== undefined;
    if (wantsProgress) {
      await updateSyncJob({
        id: jobId,
        progress: typeof body.progress === "number" ? body.progress : undefined,
        fetchedCount:
          typeof body.fetched_count === "number" ? body.fetched_count : undefined,
        stats:
          body.stats && typeof body.stats === "object"
            ? (body.stats as Record<string, unknown>)
            : undefined,
      });
    }

    // Финал: успех.
    if (body.done && typeof body.done === "object") {
      const d = body.done as Record<string, unknown>;
      const fetched =
        typeof d.fetched_count === "number" ? d.fetched_count : undefined;
      const stats =
        d.stats && typeof d.stats === "object"
          ? (d.stats as Record<string, unknown>)
          : undefined;

      await finishSyncJob({
        id: jobId,
        status: "done",
        fetchedCount: fetched,
        stats,
      });

      // Только для pull-job'ов двигаем cursor и next_run_at источника.
      // embed-job не управляет расписанием источника.
      if (job.job_kind === "pull") {
        await scheduleNextRun({
          id: job.source_id,
          cursor: d.cursor,
        });
      }
      return NextResponse.json({ ok: true });
    }

    // Финал: ошибка.
    if (body.error && typeof body.error === "object") {
      const e = body.error as Record<string, unknown>;
      const message = typeof e.message === "string" ? e.message : "adapter sync error";
      const retryAfter =
        typeof e.retry_after_sec === "number" ? e.retry_after_sec : undefined;

      const error_id = await logError({
        level: "error",
        source: "server",
        route: "/api/adapters/update",
        message,
        stack: typeof e.stack === "string" ? e.stack : null,
        meta: { job_id: jobId, source_id: job.source_id, kind: job.kind, worker_meta: e.meta },
      });

      await finishSyncJob({
        id: jobId,
        status: "error",
        errorMessage: message,
        errorId: error_id,
      });
      if (job.job_kind === "pull") {
        await markSourceError({
          id: job.source_id,
          message,
          errorId: error_id,
          retryAfterSec: retryAfter,
        });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const error_id = await logServerError(err, "/api/adapters/update", { jobId });
    return NextResponse.json({ error: "update failed", error_id }, { status: 500 });
  }
}
