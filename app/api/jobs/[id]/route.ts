import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { getJob, getSegments } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/jobs/[id]
// Возвращает текущее состояние job: статус, прогресс, аудио, сегменты.
// Открыт без авторизации — клиент-поллер тянет своё состояние по id из URL.
// id — UUID, угадать невозможно, играет роль capability-токена.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const job = await getJob(id);
    if (!job) {
      return NextResponse.json({ error: "job not found" }, { status: 404 });
    }
    // Сегменты тянем только когда они уже могли появиться, чтобы не делать
    // лишний запрос на этапах download/asr (до перевода они ещё неполные).
    const segments =
      job.status === "done" || job.stage === "translate" || job.stage === "tts" || job.stage === "mux"
        ? await getSegments(id)
        : [];

    return NextResponse.json({
      job: {
        id: job.id,
        url: job.yt_url,
        video_id: job.yt_video_id,
        title: job.yt_title,
        duration_sec: job.yt_duration_sec,
        source_lang: job.source_lang,
        target_lang: job.target_lang,
        quality: job.quality,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        error_message: job.error_message,
        error_id: job.error_id,
        audio_url: job.audio_url,
        created_at: job.created_at,
        updated_at: job.updated_at,
        finished_at: job.finished_at,
      },
      segments: segments.map((s) => ({
        idx: s.idx,
        start_ms: s.start_ms,
        end_ms: s.end_ms,
        source_text: s.source_text,
        translated_text: s.translated_text,
      })),
    });
  } catch (err) {
    const error_id = await logServerError(err, `/api/jobs/${id}`);
    return NextResponse.json(
      { error: "не удалось прочитать задачу", error_id },
      { status: 500 },
    );
  }
}
