import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { checkAdminToken } from "@/lib/auth";
import { logServerError } from "@/lib/logger";
import { runEnrichTick } from "@/lib/enrichment-pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Полный enrichment (v1.5): Perplexity sonar-pro (~25s) + параллельный fetch
// 4-6 источников (~10-15s) + Opus 4.8 синтез длинной статьи (~40-60s).
// Vercel Pro даёт до 300s, ставим 120 — с запасом, но не на потолке.
export const maxDuration = 120;

// POST/GET /api/news/enrich/tick — обрабатывает один pending enrichment.
// Auth — та же конвенция, что и /api/news/cron/tick (см. project convention).
async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const stats = await runEnrichTick();
    return NextResponse.json({ ok: true, ts: new Date().toISOString(), stats });
  } catch (err) {
    const error_id = await logServerError(err, "news/enrich/tick");
    return NextResponse.json({ ok: false, error: "enrich tick failed", error_id }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") || "";
    const provided = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    if (provided && constantTimeEqual(provided, cronSecret)) return true;
  }
  const adminCheck = checkAdminToken(req);
  if (adminCheck.ok) return true;
  return !cronSecret;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
