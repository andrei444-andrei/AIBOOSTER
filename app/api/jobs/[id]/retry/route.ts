// POST /api/jobs/[id]/retry
// Возвращает упавшую (или зависшую) задачу в очередь.
//
// Ретрай дешёвый: пайплайн резюмируемый, уже переведённые и озвученные чанки
// лежат в video_translation_chunks и переиспользуются — доделывается только
// недостающее. Поэтому кнопка «попробовать снова» не значит «заплатить за
// перевод и озвучку заново».
//
// Без авторизации — id играет роль capability-токена, как в GET/PATCH соседа.

import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getJob, requeueJob } from "@/lib/jobs";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const existing = await getJob(id);
    if (!existing) {
      return NextResponse.json({ error: "job not found" }, { status: 404 });
    }
    if (existing.status === "done") {
      return NextResponse.json(
        { error: "эта задача уже готова — перезапускать нечего" },
        { status: 409 },
      );
    }
    if (existing.status === "queued") {
      // Уже в очереди — считаем успехом, кнопку могли нажать дважды.
      return NextResponse.json({ ok: true, status: "queued" });
    }

    const job = await requeueJob(id);
    if (!job) {
      return NextResponse.json(
        { error: "не удалось вернуть задачу в очередь" },
        { status: 409 },
      );
    }
    // Не ждём следующего тика крона — дёргаем обработку сразу.
    waitUntil(triggerProcessing(req));
    return NextResponse.json({ ok: true, status: job.status });
  } catch (err) {
    const error_id = await logServerError(err, `/api/jobs/${id}/retry`);
    return NextResponse.json(
      { error: "не удалось перезапустить задачу", error_id },
      { status: 500 },
    );
  }
}

// Дёргает /api/cron/process-jobs на этом же деплое, чтобы он забрал job
// сразу. Тот эндпоинт живёт своей инвокацией со своим лимитом, поэтому
// нам не важно, доживёт ли этот запрос до его завершения.
async function triggerProcessing(req: Request): Promise<void> {
  const secret = process.env.CRON_SECRET || process.env.ADMIN_TOKEN || "";
  if (!secret) return;
  const origin = new URL(req.url).origin;
  try {
    await fetch(`${origin}/api/cron/process-jobs`, {
      headers: { authorization: `Bearer ${secret}` },
    });
  } catch (err) {
    console.error("[jobs/retry] background trigger failed:", err);
  }
}
