// Vercel Cron: каждую минуту разгребает очередь перевода видео (Apify →
// translate → TTS → mux → R2). Заменяет внешний worker — больше не нужен
// отдельный контейнер на Railway/Fly.
//
// Тик работает ПО БЮДЖЕТУ, а не «одна job за вызов». Пайплайн резюмируемый
// (см. lib/pipeline/run.ts): job раскладывается на чанки, каждый обработанный
// кусок сразу в БД. Тик делает столько, сколько влезает в maxDuration, и
// выходит; недоделанная job остаётся в статусе running с недавним claimed_at,
// поэтому этот же тик её повторно не возьмёт, а следующий — продолжит с того
// места, где встали. Так обрабатываются видео любой длины.
//
// Аутентификация: Vercel автоматически отправляет Bearer-токен с CRON_SECRET,
// мы его проверяем. См. https://vercel.com/docs/cron-jobs/manage-cron-jobs

import { NextResponse } from "next/server";
import { claimNextJob } from "@/lib/jobs";
import { runJob } from "@/lib/pipeline/run";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 800 секунд — потолок Pro-плана для Vercel Functions (GA поверх fluid
// compute). Мы платим за активный CPU, а пайплайн почти всё время ждёт
// ответа aimlapi/ElevenLabs, так что длинное окно почти ничего не стоит.
export const maxDuration = 800;

const WORKER_ID = "vercel-cron";

// Оставляем запас от maxDuration: пайплайн должен успеть аккуратно
// дописать прогресс в БД и вернуть ответ, а не быть убитым на середине.
const BUDGET_MS = (maxDuration - 40) * 1000;

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

  const deadline = Date.now() + BUDGET_MS;
  const processed: Array<{ job_id: string; finished: boolean; stage: string | null }> = [];

  while (Date.now() < deadline) {
    let job;
    try {
      job = await claimNextJob(WORKER_ID);
    } catch (err) {
      const error_id = await logServerError(err, "/api/cron/process-jobs", {
        phase: "claim",
      });
      return NextResponse.json(
        { error: "claim failed", error_id, processed },
        { status: 500 },
      );
    }
    if (!job) break;

    // runJob сам ловит свои ошибки и пишет в app_errors через markJobError.
    const res = await runJob(job, deadline);
    processed.push({ job_id: job.id, finished: res.finished, stage: res.stage });
  }

  return NextResponse.json({ ok: true, picked: processed.length > 0, processed });
}
