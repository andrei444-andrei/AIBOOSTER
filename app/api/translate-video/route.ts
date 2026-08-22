import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { logServerError } from "@/lib/logger";
import { createJob, findCachedJob } from "@/lib/jobs";
import {
  extractVideoId,
  fetchYoutubeTitle,
  isSupportedLang,
  isSupportedQuality,
  type Quality,
} from "@/lib/youtube";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/translate-video
// Body: { url: string, target_lang: string, quality?: 'fast' | 'best' }
// Возвращает { job_id, cached: boolean }.
//
// Если для (videoId, target_lang, quality) уже есть готовая job — отдаём её
// id (cached=true), не создаём новую. Это экономит ASR/TTS-минуты.
//
// При создании новой job — в фоне дёргаем /api/cron/process-jobs через
// waitUntil, чтобы юзер не ждал минуту до следующего тика Vercel Cron.
// HTTP-ответ ему отдаём мгновенно с job_id, а пайплайн стартует параллельно.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url : "";
  const targetLang = typeof body.target_lang === "string" ? body.target_lang : "";
  const quality: Quality = isSupportedQuality(String(body.quality)) ? (body.quality as Quality) : "best";

  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  const videoId = extractVideoId(url);
  if (!videoId) {
    return NextResponse.json(
      { error: "не похоже на ссылку YouTube — проверь и вставь ещё раз" },
      { status: 400 },
    );
  }
  if (!targetLang || !isSupportedLang(targetLang)) {
    return NextResponse.json({ error: "target_lang is missing or unsupported" }, { status: 400 });
  }

  try {
    const cached = await findCachedJob(videoId, targetLang, quality);
    if (cached) {
      return NextResponse.json({ job_id: cached.id, cached: true });
    }
    // oEmbed подтянет название в фоне (быстрый запрос ~100мс). Если упадёт
    // или вернёт null — карточка пока без заголовка, потом пайплайн заменит.
    const title = await fetchYoutubeTitle(videoId);
    const job = await createJob({ videoId, url, targetLang, quality, title });
    waitUntil(triggerProcessing(req));
    return NextResponse.json({ job_id: job.id, cached: false });
  } catch (err) {
    const error_id = await logServerError(err, "/api/translate-video", { url, targetLang, quality });
    return NextResponse.json(
      { error: "не удалось создать задачу", error_id },
      { status: 500 },
    );
  }
}

// Дёргает /api/cron/process-jobs на этом же деплое, чтобы он забрал только
// что созданную job. Vercel держит инвокацию через waitUntil даже после
// возврата основного HTTP-ответа.
async function triggerProcessing(req: Request): Promise<void> {
  const secret = process.env.CRON_SECRET || process.env.ADMIN_TOKEN || "";
  if (!secret) return;
  const origin = new URL(req.url).origin;
  try {
    await fetch(`${origin}/api/cron/process-jobs`, {
      headers: { authorization: `Bearer ${secret}` },
    });
  } catch (err) {
    console.error("[translate-video] background trigger failed:", err);
  }
}
