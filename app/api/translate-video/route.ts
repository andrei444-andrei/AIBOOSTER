import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { createJob, findCachedJob } from "@/lib/jobs";
import {
  extractVideoId,
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
    const job = await createJob({ videoId, url, targetLang, quality });
    return NextResponse.json({ job_id: job.id, cached: false });
  } catch (err) {
    const error_id = await logServerError(err, "/api/translate-video", { url, targetLang, quality });
    return NextResponse.json(
      { error: "не удалось создать задачу", error_id },
      { status: 500 },
    );
  }
}
