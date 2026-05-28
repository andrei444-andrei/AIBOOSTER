import { NextResponse } from "next/server";
import { checkAdminToken } from "@/lib/auth";
import { logServerError } from "@/lib/logger";
import { getActiveProfile, upsertProfile } from "@/lib/news";
import type { InterestTopic } from "@/lib/news-prompt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  try {
    const p = await getActiveProfile();
    return NextResponse.json({ profile: p });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/profile GET");
    return NextResponse.json({ error: "failed", error_id }, { status: 500 });
  }
}

// PUT /api/news/profile { worldview_context, topics: [{name, description?, what_bores_me?, priority?, status?}] }
export async function PUT(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const worldview = typeof body.worldview_context === "string" ? body.worldview_context.slice(0, 10_000) : "";
  const topicsRaw = Array.isArray(body.topics) ? body.topics.slice(0, 100) : [];
  const topics: InterestTopic[] = [];
  for (const t of topicsRaw) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name.trim()) continue;
    const prio = r.priority;
    const stat = r.status;
    topics.push({
      name: r.name.trim().slice(0, 200),
      description: typeof r.description === "string" ? r.description.slice(0, 2000) : undefined,
      what_bores_me: typeof r.what_bores_me === "string" ? r.what_bores_me.slice(0, 2000) : undefined,
      priority: prio === "low" || prio === "medium" || prio === "high" ? prio : "medium",
      status: stat === "active" || stat === "muted" ? stat : "active",
    });
  }
  try {
    await upsertProfile({ worldview_context: worldview, topics });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/profile PUT");
    return NextResponse.json({ error: "failed", error_id }, { status: 500 });
  }
}
