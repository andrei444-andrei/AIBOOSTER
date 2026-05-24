import { NextResponse } from "next/server";
import { checkWorkerSecret } from "@/lib/worker-auth";
import { logError, logServerError } from "@/lib/logger";
import {
  getJob,
  markJobDone,
  markJobError,
  replaceSegments,
  updateJobProgress,
  type JobStage,
} from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/worker/update
// Универсальный апдейт от воркера.
// Body:
//   {
//     job_id: string,
//     // progress
//     stage?: 'download'|'asr'|'translate'|'tts'|'mux',
//     progress?: number,         // 0..100
//     title?: string,
//     duration_sec?: number,
//     source_lang?: string,
//     // segments — перезаписывает всю таблицу сегментов
//     segments?: Array<{ idx, start_ms, end_ms, source_text?, translated_text? }>,
//     // финальные состояния
//     done?: { audio_url: string },
//     error?: { message: string, stack?: string, meta?: unknown },
//   }
//
// Любая комбинация полей валидна — воркер вызывает этот эндпоинт после
// каждого значимого шага.
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
    const job = await getJob(jobId);
    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

    // Прогресс/метаданные.
    const wantsProgress =
      body.stage !== undefined ||
      body.progress !== undefined ||
      body.title !== undefined ||
      body.duration_sec !== undefined ||
      body.source_lang !== undefined;
    if (wantsProgress) {
      const stage =
        typeof body.stage === "string" && isStage(body.stage) ? (body.stage as JobStage) : undefined;
      await updateJobProgress({
        id: jobId,
        stage,
        progress: typeof body.progress === "number" ? body.progress : undefined,
        title: body.title === null ? null : typeof body.title === "string" ? body.title : undefined,
        durationSec: typeof body.duration_sec === "number" ? body.duration_sec : undefined,
        sourceLang:
          body.source_lang === null
            ? null
            : typeof body.source_lang === "string"
              ? body.source_lang
              : undefined,
      });
    }

    // Сегменты.
    if (Array.isArray(body.segments)) {
      const segments = body.segments
        .map((s): { idx: number; start_ms: number; end_ms: number; source_text?: string | null; translated_text?: string | null } | null => {
          if (!s || typeof s !== "object") return null;
          const row = s as Record<string, unknown>;
          const idx = typeof row.idx === "number" ? row.idx : NaN;
          const start_ms = typeof row.start_ms === "number" ? row.start_ms : NaN;
          const end_ms = typeof row.end_ms === "number" ? row.end_ms : NaN;
          if (!Number.isFinite(idx) || !Number.isFinite(start_ms) || !Number.isFinite(end_ms)) return null;
          return {
            idx,
            start_ms,
            end_ms,
            source_text: typeof row.source_text === "string" ? row.source_text : null,
            translated_text: typeof row.translated_text === "string" ? row.translated_text : null,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);
      await replaceSegments(jobId, segments);
    }

    // Финальные состояния.
    if (body.done && typeof body.done === "object") {
      const url = (body.done as Record<string, unknown>).audio_url;
      if (typeof url !== "string" || !url) {
        return NextResponse.json({ error: "done.audio_url is required" }, { status: 400 });
      }
      await markJobDone({ id: jobId, audioUrl: url });
    } else if (body.error && typeof body.error === "object") {
      const e = body.error as Record<string, unknown>;
      const message = typeof e.message === "string" ? e.message : "worker error";
      const error_id = await logError({
        level: "error",
        source: "server",
        route: "/api/worker/update",
        message,
        stack: typeof e.stack === "string" ? e.stack : null,
        meta: { job_id: jobId, worker_meta: e.meta },
      });
      await markJobError({ id: jobId, message, errorId: error_id });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const error_id = await logServerError(err, "/api/worker/update", { jobId });
    return NextResponse.json({ error: "update failed", error_id }, { status: 500 });
  }
}

function isStage(v: string): v is JobStage {
  return v === "download" || v === "asr" || v === "translate" || v === "tts" || v === "mux";
}
