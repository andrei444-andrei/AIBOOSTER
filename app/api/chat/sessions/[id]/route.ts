import { NextResponse } from "next/server";
import { deleteSession, getSession, listMessages, renameSession, setSessionModel, isKnownModel } from "@/lib/chat";
import { logServerError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getUid(req: Request): string | null {
  const h = req.headers.get("x-chat-uid");
  if (!h) return null;
  const v = h.trim();
  if (!/^[A-Za-z0-9_\-]{8,64}$/.test(v)) return null;
  return v;
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const uid = getUid(req);
  if (!uid) {
    return NextResponse.json(
      { error: { code: "missing_uid", message: "x-chat-uid header required" } },
      { status: 400 },
    );
  }
  const { id } = await ctx.params;
  try {
    const session = await getSession(id, uid);
    if (!session) {
      return NextResponse.json(
        { error: { code: "not_found", message: "session not found" } },
        { status: 404 },
      );
    }
    const messages = await listMessages(id);
    return NextResponse.json({ session, messages });
  } catch (err) {
    const error_id = await logServerError(err, "/api/chat/sessions/[id] GET");
    return NextResponse.json(
      { error: { code: "load_failed", message: "failed to load session", error_id } },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const uid = getUid(req);
  if (!uid) {
    return NextResponse.json(
      { error: { code: "missing_uid", message: "x-chat-uid header required" } },
      { status: 400 },
    );
  }
  const { id } = await ctx.params;
  let body: { title?: string; model?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "bad_json", message: "invalid JSON" } }, { status: 400 });
  }
  try {
    const session = await getSession(id, uid);
    if (!session) {
      return NextResponse.json({ error: { code: "not_found", message: "session not found" } }, { status: 404 });
    }
    if (typeof body.title === "string") {
      await renameSession(id, uid, body.title);
    }
    if (typeof body.model === "string" && isKnownModel(body.model)) {
      await setSessionModel(id, uid, body.model);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const error_id = await logServerError(err, "/api/chat/sessions/[id] PATCH");
    return NextResponse.json(
      { error: { code: "patch_failed", message: "failed to update session", error_id } },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const uid = getUid(req);
  if (!uid) {
    return NextResponse.json(
      { error: { code: "missing_uid", message: "x-chat-uid header required" } },
      { status: 400 },
    );
  }
  const { id } = await ctx.params;
  try {
    const ok = await deleteSession(id, uid);
    if (!ok) {
      return NextResponse.json({ error: { code: "not_found", message: "session not found" } }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const error_id = await logServerError(err, "/api/chat/sessions/[id] DELETE");
    return NextResponse.json(
      { error: { code: "delete_failed", message: "failed to delete session", error_id } },
      { status: 500 },
    );
  }
}
