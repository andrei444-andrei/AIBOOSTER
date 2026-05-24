import { NextResponse } from "next/server";
import { createSession, listSessions, isKnownModel } from "@/lib/chat";
import { DEFAULT_MODEL } from "@/lib/ai";
import { logServerError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getUid(req: Request): string | null {
  const h = req.headers.get("x-chat-uid");
  if (!h) return null;
  // принимаем только разумные UID (UUID-формат или просто [a-zA-Z0-9-_], 8..64 символа)
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

export async function POST(req: Request) {
  const uid = getUid(req);
  if (!uid) {
    return NextResponse.json(
      { error: { code: "missing_uid", message: "x-chat-uid header required" } },
      { status: 400 },
    );
  }
  let body: { model?: string; title?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // пустое тело — OK
  }
  const model = body.model && isKnownModel(body.model) ? body.model : DEFAULT_MODEL;
  const title = (body.title ?? "Новый чат").slice(0, 200);
  try {
    const session = await createSession(uid, model, title);
    return NextResponse.json({ session });
  } catch (err) {
    const error_id = await logServerError(err, "/api/chat/sessions POST");
    return NextResponse.json(
      { error: { code: "create_failed", message: "failed to create session", error_id } },
      { status: 500 },
    );
  }
}
