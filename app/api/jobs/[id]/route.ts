import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { getJob, getSegments, updateJobPlayback, type WatchStatus } from "@/lib/jobs";
import { getChunkStats } from "@/lib/chunks";

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

    // Счётчики фрагментов — чтобы в прогрессе было видно «12 из 27», а не
    // только проценты. На длинном видео это единственный честный ответ на
    // вопрос «оно вообще движется?»: работа идёт несколько тиков крона.
    const chunks =
      job.status === "running" || job.status === "queued"
        ? await getChunkStats(id)
        : null;

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
        watch_status: job.watch_status,
        last_position_sec: job.last_position_sec,
        source: job.source,
        summary: job.summary,
        chapters: parseChapters(job.chapters),
        chunks_total: chunks?.total ?? null,
        chunks_translated: chunks?.translated ?? null,
        chunks_voiced: chunks?.voiced ?? null,
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

// PATCH /api/jobs/[id]
// Обновляет «зрительские» поля: позицию воспроизведения и watch_status.
// Тело: { last_position_sec?: number, watch_status?: 'to_watch'|'watched' }.
// Используется аудио-плеером (сохраняет позицию каждые ~5с) и кнопкой
// «отметить как просмотрено» в библиотеке. Без авторизации — id играет
// роль capability-токена (как и в GET).
// Распарсивает chapters из JSON-строки в массив. На любых сбоях
// (битый JSON, не массив, не те типы внутри) — возвращаем пустой массив.
function parseChapters(raw: string | null): Array<{ start_sec: number; title: string }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: Array<{ start_sec: number; title: string }> = [];
    for (const c of parsed) {
      if (!c || typeof c !== "object") continue;
      const o = c as Record<string, unknown>;
      if (typeof o.start_sec === "number" && typeof o.title === "string") {
        out.push({ start_sec: o.start_sec, title: o.title });
      }
    }
    return out;
  } catch {
    return [];
  }
}

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
    const job = await getJob(id);
    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
    await updateJobPlayback({ id, positionSec, watchStatus });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const error_id = await logServerError(err, `/api/jobs/${id} PATCH`);
    return NextResponse.json(
      { error: "не удалось обновить задачу", error_id },
      { status: 500 },
    );
  }
}
