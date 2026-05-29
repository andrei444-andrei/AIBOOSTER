import { NextResponse } from "next/server";
import { createSession, listSessions, isKnownModel, isTaskCategory, isChatMode } from "@/lib/chat";
import type { ChatMode } from "@/lib/chat-client";
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

export async function GET(req: Request) {
  const uid = getUid(req);
  if (!uid) {
    return NextResponse.json(
      { error: { code: "missing_uid", message: "x-chat-uid header required" } },
      { status: 400 },
    );
  }
  try {
    const sessions = await listSessions(uid);
    return NextResponse.json({ sessions });
  } catch (err) {
    const error_id = await logServerError(err, "/api/chat/sessions GET");
    return NextResponse.json(
      { error: { code: "list_failed", message: "failed to list sessions", error_id } },
      { status: 500 },
    );
  }
}

interface CreateBody {
  mode?: ChatMode | null;
  modelOverride?: string | null;
  categoryOverride?: string | null;
  title?: string;
}

export async function POST(req: Request) {
  const uid = getUid(req);
  if (!uid) {
    return NextResponse.json(
      { error: { code: "missing_uid", message: "x-chat-uid header required" } },
      { status: 400 },
    );
  }
  let body: CreateBody = {};
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    // пустое тело — OK
  }
  const mode = body.mode && isChatMode(body.mode) ? body.mode : null;
  const modelOverride =
    body.modelOverride && isKnownModel(body.modelOverride) ? body.modelOverride : null;
  const categoryOverride =
    body.categoryOverride && isTaskCategory(body.categoryOverride) ? body.categoryOverride : null;
  const title = body.title?.slice(0, 200);
  try {
    const session = await createSession(uid, {
      mode,
      modelOverride,
      categoryOverride,
      title,
    });
    return NextResponse.json({ session });
  } catch (err) {
    const error_id = await logServerError(err, "/api/chat/sessions POST");
    return NextResponse.json(
      { error: { code: "create_failed", message: "failed to create session", error_id } },
      { status: 500 },
    );
  }
}
