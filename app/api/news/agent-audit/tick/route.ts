import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { checkAdminToken } from "@/lib/auth";
import { logServerError } from "@/lib/logger";
import { runMaintenanceAudit } from "@/lib/maintenance-agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Opus 4.8 за audit ~30-50s + actions (deactivate/retry — мгновенные,
// rediscover_source делает HTTP-fetch ~10s × до N).
export const maxDuration = 120;

// POST/GET /api/news/agent-audit/tick
// Cron-triggered и manually triggerable. Та же auth-конвенция, что и cron/tick.
async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runMaintenanceAudit();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const error_id = await logServerError(err, "news/agent-audit/tick");
    return NextResponse.json({ ok: false, error: "audit failed", error_id }, { status: 500 });
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
