import { NextResponse } from "next/server";
import { checkAdminToken } from "@/lib/auth";
import { listRoutes, updateRoutes, type RouteInput } from "@/lib/routing-config";
import { isTaskCategory, isReasoningEffort, isKnownModel } from "@/lib/chat-client";
import { logServerError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: auth.reason } },
      { status: auth.status },
    );
  }
  try {
    const routes = await listRoutes();
    return NextResponse.json({ routes });
  } catch (err) {
    const error_id = await logServerError(err, "/api/admin/chat-routing GET");
    return NextResponse.json(
      { error: { code: "load_failed", message: "failed to load routes", error_id } },
      { status: 500 },
    );
  }
}

interface PutBody {
  routes: Array<{
    category: string;
    model: string;
    reasoning_effort: string | null;
    max_tokens: number;
  }>;
}

export async function PUT(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: auth.reason } },
      { status: auth.status },
    );
  }
  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json(
      { error: { code: "bad_json", message: "invalid JSON" } },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.routes)) {
    return NextResponse.json(
      { error: { code: "bad_body", message: "routes array required" } },
      { status: 400 },
    );
  }
  const cleaned: RouteInput[] = [];
  for (const r of body.routes) {
    if (!isTaskCategory(r.category)) {
      return NextResponse.json(
        { error: { code: "bad_category", message: `unknown category: ${r.category}` } },
        { status: 400 },
      );
    }
    if (!isKnownModel(r.model)) {
      return NextResponse.json(
        { error: { code: "bad_model", message: `unknown model: ${r.model}` } },
        { status: 400 },
      );
    }
    const re = r.reasoning_effort && isReasoningEffort(r.reasoning_effort) ? r.reasoning_effort : null;
    const maxT = Number.isFinite(r.max_tokens) && r.max_tokens > 0 ? Math.min(r.max_tokens, 32000) : 4000;
    cleaned.push({
      category: r.category,
      model: r.model,
      reasoning_effort: re,
      max_tokens: maxT,
    });
  }
  try {
    await updateRoutes(cleaned);
    const updated = await listRoutes();
    return NextResponse.json({ routes: updated });
  } catch (err) {
    const error_id = await logServerError(err, "/api/admin/chat-routing PUT");
    return NextResponse.json(
      { error: { code: "save_failed", message: "failed to save routes", error_id } },
      { status: 500 },
    );
  }
}
