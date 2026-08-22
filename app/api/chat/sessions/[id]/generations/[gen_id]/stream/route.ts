// SSE-endpoint для подключения к ИДУЩЕЙ или УЖЕ ЗАВЕРШИВШЕЙСЯ генерации.
//
// Зачем: пользователь закрыл вкладку → пайплайн в POST /messages продолжает
// писать content в БД throttled. Клиент вернулся → открывает GET на этот
// endpoint → получает накопленный текст одним куском + дельты по мере
// прибытия новых токенов.
//
// Контракт SSE (то же, что POST /messages, но без user_message/route в
// начале — это уже передано в первый раз):
//   resume      { id, content, status, route, web_images, citations }  ← первый event с накопленным состоянием
//   delta       { text }                                                  ← новые токены пока генерация идёт
//   web_images  { images }
//   citations   { citations }
//   done        { id, ..., route, ... }
//   error       { message, error_id? }
//
// Polling: проверяем БД каждые 500мс. Когда status != 'running' — финализируем
// и закрываем stream.

import { getGeneration } from "@/lib/generations";
import { getSession } from "@/lib/chat";
import { logServerError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string; gen_id: string }> };

function getUid(req: Request): string | null {
  const h = req.headers.get("x-chat-uid");
  if (!h) return null;
  const v = h.trim();
  if (!/^[A-Za-z0-9_\-]{8,64}$/.test(v)) return null;
  return v;
}

export async function GET(req: Request, ctx: Ctx) {
  const uid = getUid(req);
  if (!uid) {
    return Response.json(
      { error: { code: "missing_uid", message: "x-chat-uid header required" } },
      { status: 400 },
    );
  }
  const { id: sessionId, gen_id: genId } = await ctx.params;

  // Verify session ownership
  const session = await getSession(sessionId, uid).catch(() => null);
  if (!session) {
    return Response.json(
      { error: { code: "not_found", message: "session not found" } },
      { status: 404 },
    );
  }

  const initial = await getGeneration(genId).catch(() => null);
  if (!initial || initial.session_id !== sessionId) {
    return Response.json(
      { error: { code: "not_found", message: "generation not found" } },
      { status: 404 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // 1) Первое событие — resume с накопленным состоянием.
      send("resume", {
        id: initial.id,
        content: initial.content,
        status: initial.status,
        model: initial.model,
        mode: initial.mode,
        route: initial.route_meta,
        web_images: initial.web_images ?? [],
        citations: initial.citations ?? [],
      });

      // 2) Если уже не running — сразу done/error и закрываемся.
      if (initial.status === "done") {
        send("done", {
          id: initial.assistant_message_id,
          created_at: initial.finished_at,
          model: initial.model,
          duration_ms: initial.duration_ms,
          usage: initial.tokens_completion != null ? {
            prompt_tokens: initial.tokens_prompt ?? 0,
            completion_tokens: initial.tokens_completion,
            total_tokens: (initial.tokens_prompt ?? 0) + initial.tokens_completion,
          } : null,
          route: initial.route_meta,
          web_images: initial.web_images ?? [],
          citations: initial.citations ?? [],
        });
        controller.close();
        return;
      }
      if (initial.status === "error" || initial.status === "cancelled") {
        send("error", {
          message: initial.error ?? (initial.status === "cancelled" ? "Генерация прервана" : "Ошибка генерации"),
        });
        controller.close();
        return;
      }

      // 3) status=running → поллим БД до завершения.
      let lastContentLen = initial.content.length;
      let lastImagesCount = (initial.web_images ?? []).length;
      let lastCitationsCount = (initial.citations ?? []).length;
      const POLL_MS = 500;
      const POLL_MAX_TICKS = Math.floor((300 * 1000) / POLL_MS); // защита от вечного цикла

      for (let i = 0; i < POLL_MAX_TICKS && !closed; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (closed) break;

        const cur = await getGeneration(genId).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[stream] poll failed:", err);
          return null;
        });
        if (!cur) continue;

        // Шлём дельту контента, если что-то дописали.
        if (cur.content.length > lastContentLen) {
          const delta = cur.content.slice(lastContentLen);
          send("delta", { text: delta });
          lastContentLen = cur.content.length;
        }

        const imgs = cur.web_images ?? [];
        if (imgs.length > lastImagesCount) {
          const fresh = imgs.slice(lastImagesCount);
          send("web_images", { images: fresh });
          lastImagesCount = imgs.length;
        }
        const cits = cur.citations ?? [];
        if (cits.length > lastCitationsCount) {
          const fresh = cits.slice(lastCitationsCount);
          send("citations", { citations: fresh });
          lastCitationsCount = cits.length;
        }

        // Финал?
        if (cur.status === "done") {
          send("done", {
            id: cur.assistant_message_id,
            created_at: cur.finished_at,
            model: cur.model,
            duration_ms: cur.duration_ms,
            usage: cur.tokens_completion != null ? {
              prompt_tokens: cur.tokens_prompt ?? 0,
              completion_tokens: cur.tokens_completion,
              total_tokens: (cur.tokens_prompt ?? 0) + cur.tokens_completion,
            } : null,
            route: cur.route_meta,
            web_images: imgs,
            citations: cits,
          });
          controller.close();
          return;
        }
        if (cur.status === "error" || cur.status === "cancelled") {
          send("error", { message: cur.error ?? "Генерация прервана" });
          controller.close();
          return;
        }
      }

      // Достигли потолка polling — закрываем с предупреждением.
      send("error", { message: "Stream timeout — попробуйте обновить страницу" });
      try { controller.close(); } catch { /* already closed */ }
    },
    cancel() {
      // Клиент отключился. Polling-loop проверяет `closed` через send() и
      // сам выйдет. Сама генерация продолжает работать в POST-функции.
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
