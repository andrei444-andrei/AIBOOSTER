import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { checkAdminToken } from "@/lib/auth";
import { logServerError } from "@/lib/logger";
import { runDiscovery } from "@/lib/discovery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Discovery — последовательно крутит до 12 тем × ~5-10s Perplexity каждая.
// Бывает 60-90s в худшем случае → берём 120s.
export const maxDuration = 120;

// POST/GET /api/news/discovery/tick
//
// Триггер Vercel Cron: каждые 6 часов. Идёт по активным темам профиля,
// просит Perplexity найти top-5 must-read статей за неделю по каждой теме,
// заливает их как pending news_items под source'ом «Discovery: <topic>».
//
// Авторизация — та же конвенция что и в /api/news/cron/tick.
async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runDiscovery();
    return NextResponse.json({ ok: true, ts: new Date().toISOString(), ...result });
  } catch (err) {
    const error_id = await logServerError(err, "news/discovery/tick");
    return NextResponse.json(
      { ok: false, error: "discovery tick failed", error_id },
      { status: 500 },
    );
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
