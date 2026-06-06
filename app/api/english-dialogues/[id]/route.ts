import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import {
  getDialogueJob,
  getDialogueSegments,
  updateDialoguePlayback,
  type WatchStatus,
} from "@/lib/english-dialogues";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/english-dialogues/[id]
// Текущее состояние разговора: статус, прогресс, аудио, транскрипт.
// Без auth — id (UUID) играет роль capability-токена.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const job = await getDialogueJob(id);
    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

    const segments = job.status === "done" ? await getDialogueSegments(id) : [];

    return NextResponse.json({
      job: {
        id: job.id,
        topic: job.topic,
        title: job.title,
        kind: job.kind,
        duration_min: job.duration_min,
        with_translation: job.with_translation,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        error_message: job.error_message,
        error_id: job.error_id,
        audio_url: job.audio_url,
        duration_sec: job.duration_sec,
        watch_status: job.watch_status,
        last_position_sec: job.last_position_sec,
        created_at: job.created_at,
        updated_at: job.updated_at,
        finished_at: job.finished_at,
      },
      segments: segments.map((s) => ({
        idx: s.idx,
        start_ms: s.start_ms,
        end_ms: s.end_ms,
        speaker: s.speaker,
        en_text: s.en_text,
        ru_text: s.ru_text,
      })),
    });
  } catch (err) {
    const error_id = await logServerError(err, `/api/english-dialogues/${id}`);
    return NextResponse.json(
      { error: "не удалось прочитать разговор", error_id },
      { status: 500 },
    );
  }
}

// PATCH /api/english-dialogues/[id]
// Обновляет позицию и/или watch_status. Тело:
//   { last_position_sec?: number, watch_status?: 'to_watch'|'watched' }
// Шлёт плеер (раз в ~5с, на паузе/закрытии) и кнопки «в прослушанные»/«вернуть».
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  let body: { last_position_sec?: unknown; watch_status?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const positionSec =
    typeof body.last_position_sec === "number" && Number.isFinite(body.last_position_sec)
      ? body.last_position_sec
      : undefined;
  const watchStatusRaw = body.watch_status;
  const watchStatus: WatchStatus | undefined =
    watchStatusRaw === "to_watch" || watchStatusRaw === "watched"
      ? watchStatusRaw
      : undefined;

  if (positionSec === undefined && watchStatus === undefined) {
    return NextResponse.json(
      { error: "nothing to update — пришли last_position_sec и/или watch_status" },
      { status: 400 },
    );
  }

  try {
    const job = await getDialogueJob(id);
    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
    await updateDialoguePlayback({ id, positionSec, watchStatus });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const error_id = await logServerError(err, `/api/english-dialogues/${id} PATCH`);
    return NextResponse.json(
      { error: "не удалось обновить разговор", error_id },
      { status: 500 },
    );
  }
}
