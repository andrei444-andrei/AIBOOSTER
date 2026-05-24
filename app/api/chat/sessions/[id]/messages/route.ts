import {
  appendMessage,
  buildMessagesForModel,
  buildSystemPrompt,
  getSession,
  getSettings,
  isKnownModel,
  listMessages,
  renameSession,
  setSessionModel,
  type CreateAttachmentInput,
} from "@/lib/chat";
import { chatStream, AIError } from "@/lib/ai";
import { logServerError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// AIMLAPI может думать до минуты на reasoning-моделях
export const maxDuration = 120;

function getUid(req: Request): string | null {
  const h = req.headers.get("x-chat-uid");
  if (!h) return null;
  const v = h.trim();
  if (!/^[A-Za-z0-9_\-]{8,64}$/.test(v)) return null;
  return v;
}

interface IncomingAttachment {
  filename: string;
  mime_type: string;
  size: number;
  kind: "text" | "image";
  content_text?: string;
  content_base64?: string;
}

interface IncomingBody {
  content: string;
  model?: string;
  attachments?: IncomingAttachment[];
}

const MAX_TEXT_BYTES = 220_000;
const MAX_IMAGE_BYTES = 6_000_000;
const MAX_TOTAL_BYTES = 8_000_000;

function validateAttachments(input: IncomingAttachment[] | undefined): {
  ok: true;
  attachments: CreateAttachmentInput[];
} | { ok: false; reason: string } {
  if (!input || input.length === 0) return { ok: true, attachments: [] };
  if (input.length > 10) return { ok: false, reason: "too many attachments (max 10)" };

  const out: CreateAttachmentInput[] = [];
  let total = 0;
  for (const a of input) {
    if (typeof a.filename !== "string" || a.filename.length === 0) {
      return { ok: false, reason: "attachment.filename required" };
    }
    if (typeof a.mime_type !== "string" || a.mime_type.length === 0) {
      return { ok: false, reason: "attachment.mime_type required" };
    }
    if (typeof a.size !== "number" || a.size < 0) {
      return { ok: false, reason: "attachment.size invalid" };
    }
    if (a.kind === "text") {
      if (typeof a.content_text !== "string") {
        return { ok: false, reason: "attachment.content_text required for text" };
      }
      const bytes = Buffer.byteLength(a.content_text, "utf8");
      if (bytes > MAX_TEXT_BYTES) {
        return { ok: false, reason: `attachment "${a.filename}" too large (max ${MAX_TEXT_BYTES} bytes)` };
      }
      total += bytes;
      out.push({
        filename: a.filename.slice(0, 200),
        mime_type: a.mime_type.slice(0, 100),
        size: a.size,
        kind: "text",
        content_text: a.content_text,
      });
    } else if (a.kind === "image") {
      if (typeof a.content_base64 !== "string" || a.content_base64.length === 0) {
        return { ok: false, reason: "attachment.content_base64 required for image" };
      }
      // base64 → bytes ≈ length * 3/4
      const bytes = Math.floor((a.content_base64.length * 3) / 4);
      if (bytes > MAX_IMAGE_BYTES) {
        return { ok: false, reason: `image "${a.filename}" too large (max ${MAX_IMAGE_BYTES} bytes)` };
      }
      if (!/^image\//.test(a.mime_type)) {
        return { ok: false, reason: `image "${a.filename}" has non-image mime` };
      }
      total += bytes;
      out.push({
        filename: a.filename.slice(0, 200),
        mime_type: a.mime_type.slice(0, 100),
        size: a.size,
        kind: "image",
        content_base64: a.content_base64,
      });
    } else {
      return { ok: false, reason: `unknown attachment.kind: ${(a as { kind: string }).kind}` };
    }
  }

  if (total > MAX_TOTAL_BYTES) {
    return { ok: false, reason: `total attachments size exceeds ${MAX_TOTAL_BYTES} bytes` };
  }
  return { ok: true, attachments: out };
}

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const uid = getUid(req);
  if (!uid) {
    return Response.json(
      { error: { code: "missing_uid", message: "x-chat-uid header required" } },
      { status: 400 },
    );
  }
  const { id } = await ctx.params;

  let body: IncomingBody;
  try {
    body = (await req.json()) as IncomingBody;
  } catch {
    return Response.json({ error: { code: "bad_json", message: "invalid JSON" } }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  const hasAttachments = Array.isArray(body.attachments) && body.attachments.length > 0;
  if (!content && !hasAttachments) {
    return Response.json(
      { error: { code: "empty", message: "message is empty" } },
      { status: 400 },
    );
  }

  const validation = validateAttachments(body.attachments);
  if (!validation.ok) {
    return Response.json(
      { error: { code: "bad_attachment", message: validation.reason } },
      { status: 400 },
    );
  }

  const session = await getSession(id, uid).catch(() => null);
  if (!session) {
    return Response.json(
      { error: { code: "not_found", message: "session not found" } },
      { status: 404 },
    );
  }

  // если модель в body отличается — обновляем и сессию
  let model = session.model;
  if (body.model && isKnownModel(body.model) && body.model !== model) {
    model = body.model;
    await setSessionModel(id, uid, model);
  }

  // Сохраняем сообщение пользователя со вложениями
  const userMsg = await appendMessage(id, "user", content, {
    attachments: validation.attachments,
  });

  // Авто-заголовок: если это первое сообщение, берём первую строку
  const history = await listMessages(id);
  if (history.filter((m) => m.role === "user").length === 1) {
    const firstLine = (content || validation.attachments[0]?.filename || "Новый чат").split("\n")[0].trim();
    const title = firstLine.length > 60 ? firstLine.slice(0, 57) + "…" : firstLine;
    if (title) await renameSession(id, uid, title);
  }

  // Готовим стрим
  const settings = await getSettings();
  const systemPrompt = buildSystemPrompt(settings);
  const aiMessages = buildMessagesForModel(systemPrompt, history, model);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("user_message", { id: userMsg.id, created_at: userMsg.created_at });

      let acc = "";
      const usageRef: { current: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null } =
        { current: null };

      try {
        await chatStream(
          {
            model,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            messages: aiMessages as any,
            max_tokens: model.startsWith("gpt-5") ? 4000 : 2000,
          },
          {
            onDelta: (text) => {
              acc += text;
              send("delta", { text });
            },
            onUsage: (u) => {
              usageRef.current = u;
            },
          },
        );
      } catch (err) {
        let message = "AI request failed";
        let status: number | undefined;
        if (err instanceof AIError) {
          message = err.message;
          status = err.status;
        } else if (err instanceof Error) {
          message = err.message;
        }
        const error_id = await logServerError(err, "/api/chat/sessions/[id]/messages", {
          session_id: id,
          model,
          status,
        });
        send("error", { message, error_id });
        controller.close();
        return;
      }

      if (!acc.trim()) {
        const error_id = await logServerError(
          new Error("empty response from model"),
          "/api/chat/sessions/[id]/messages",
          { session_id: id, model },
        );
        send("error", { message: "Модель вернула пустой ответ.", error_id });
        controller.close();
        return;
      }

      const assistantMsg = await appendMessage(id, "assistant", acc, {
        model,
        tokensPrompt: usageRef.current?.prompt_tokens ?? null,
        tokensCompletion: usageRef.current?.completion_tokens ?? null,
      }).catch(async (err) => {
        await logServerError(err, "/api/chat/sessions/[id]/messages save assistant", { session_id: id });
        return null;
      });

      send("done", {
        id: assistantMsg?.id ?? null,
        created_at: assistantMsg?.created_at ?? new Date().toISOString(),
        model,
        usage: usageRef.current,
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
