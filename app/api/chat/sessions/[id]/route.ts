import { NextResponse } from "next/server";
import {
  deleteSession,
  getSession,
  listMessages,
  renameSession,
  setSessionModelOverride,
  setSessionCategoryOverride,
  setSessionMode,
  clearSessionOverride,
  isKnownModel,
  isTaskCategory,
  isChatMode,
} from "@/lib/chat";
import { getActiveGeneration } from "@/lib/generations";
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
    const [messages, activeGen] = await Promise.all([
      listMessages(id),
      getActiveGeneration(id).catch(() => null),
    ]);
    return NextResponse.json({
      session,
      messages,
      // active_generation: если есть идущая генерация для этой сессии — клиент
      // подключится к её SSE-стриму через /generations/[id]/stream и увидит
      // partial content + новые токены.
      active_generation: activeGen
        ? {
            id: activeGen.id,
            status: activeGen.status,
            mode: activeGen.mode,
            content: activeGen.content,
            user_message_id: activeGen.user_message_id,
            created_at: activeGen.created_at,
          }
        : null,
    });
  } catch (err) {
    const error_id = await logServerError(err, "/api/chat/sessions/[id] GET");
    return NextResponse.json(
      { error: { code: "load_failed", message: "failed to load session", error_id } },
      { status: 500 },
    );
  }
}

interface PatchBody {
  title?: string;
  /** Режим (thinking/pro/judge/image) ИЛИ null = Auto. Имеет приоритет над model/category. */
  mode?: ChatMode | null;
  /** Конкретная модель (строка) ИЛИ null = снять (legacy). */
  modelOverride?: string | null;
  /** Категория-пресет ИЛИ null = снять (legacy). */
  categoryOverride?: string | null;
  /** Полностью сбросить выбор → Auto. Эквивалентно mode=null + modelOverride=null + categoryOverride=null. */
  reset?: boolean;
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
  let body: PatchBody = {};
  try {
    body = (await req.json()) as PatchBody;
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
    if (body.reset) {
      await clearSessionOverride(id, uid);
    } else if ("mode" in body) {
      if (body.mode === null) {
        await setSessionMode(id, uid, null);
      } else if (isChatMode(body.mode)) {
        await setSessionMode(id, uid, body.mode);
      }
    } else if ("modelOverride" in body) {
      if (body.modelOverride === null) {
        await setSessionModelOverride(id, uid, null);
      } else if (typeof body.modelOverride === "string" && isKnownModel(body.modelOverride)) {
        await setSessionModelOverride(id, uid, body.modelOverride);
      }
    } else if ("categoryOverride" in body) {
      if (body.categoryOverride === null) {
        await setSessionCategoryOverride(id, uid, null);
      } else if (typeof body.categoryOverride === "string" && isTaskCategory(body.categoryOverride)) {
        await setSessionCategoryOverride(id, uid, body.categoryOverride);
      }
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
