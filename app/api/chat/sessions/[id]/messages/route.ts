import {
  appendMessage,
  buildMessagesForModel,
  buildSystemPrompt,
  getSession,
  getSettings,
  isKnownModel,
  isTaskCategory,
  listMessages,
  renameSession,
  setSessionLastModel,
  setSessionCategoryOverride,
  setSessionModelOverride,
  clearSessionOverride,
  type RouteMeta,
  type CreateAttachmentInput,
} from "@/lib/chat";
import { chatStream, generateImage, AIError, type WebImage, type WebCitation } from "@/lib/ai";
import { compactRecentHistory, routeRequest } from "@/lib/router";
import { ENSEMBLES, runEnsemble } from "@/lib/ensemble";
import { logServerError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Ensemble + Judge с GPT-5 reasoning=high может занимать 60-180с
// (3 кандидата параллельно + reasoning-судья). Запас даём щедро.
export const maxDuration = 240;

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
  /** Если переданы — обновляем выбор сессии перед роутингом. null = сбросить в Auto. */
  modelOverride?: string | null;
  categoryOverride?: string | null;
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

  // Принимаем точечные изменения выбора сессии из тела запроса — это даёт UI право
  // отправить сообщение и одновременно зафиксировать выбор без отдельного PATCH.
  // Правила: model и category взаимоисключающие; null = сброс в Auto.
  let currentModelOverride = session.model_override;
  let currentCategoryOverride = session.category_override;
  if ("modelOverride" in body) {
    if (body.modelOverride === null) {
      if (currentModelOverride !== null) {
        currentModelOverride = null;
        await setSessionModelOverride(id, uid, null);
      }
    } else if (
      typeof body.modelOverride === "string" &&
      isKnownModel(body.modelOverride) &&
      body.modelOverride !== currentModelOverride
    ) {
      currentModelOverride = body.modelOverride;
      currentCategoryOverride = null; // взаимоисключающие
      await setSessionModelOverride(id, uid, currentModelOverride);
    }
  } else if ("categoryOverride" in body) {
    if (body.categoryOverride === null) {
      if (currentCategoryOverride !== null) {
        currentCategoryOverride = null;
        await setSessionCategoryOverride(id, uid, null);
      }
    } else if (
      typeof body.categoryOverride === "string" &&
      isTaskCategory(body.categoryOverride) &&
      body.categoryOverride !== currentCategoryOverride
    ) {
      currentCategoryOverride = body.categoryOverride;
      currentModelOverride = null;
      await setSessionCategoryOverride(id, uid, currentCategoryOverride);
    }
  }

  // Авто-режим (оба null) — если в body передан reset, явно очищаем (хотя setSessionModelOverride
  // уже это делает выше). Дополнительной обработки не требуется.
  if (currentModelOverride === null && currentCategoryOverride === null && session.model_override === null && session.category_override === null) {
    // No-op: уже в Auto.
  } else if (body.modelOverride === null && body.categoryOverride === null) {
    await clearSessionOverride(id, uid);
    currentModelOverride = null;
    currentCategoryOverride = null;
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

  // ─── Роутинг ──────────────────────────────────────────────────────
  const multimodalNeeded = validation.attachments.some((a) => a.kind === "image");
  const decision = await routeRequest({
    userText: content,
    overrideModel: currentModelOverride,
    overrideCategory: currentCategoryOverride,
    multimodalNeeded,
    recentHistory: compactRecentHistory(
      history.slice(-5).map((m) => ({ role: m.role, content: m.content })),
    ),
  });
  const chosenModel = decision.model;

  const settings = await getSettings();
  const systemPrompt = buildSystemPrompt(settings, { addon: decision.system_addon });
  const aiMessages = buildMessagesForModel(systemPrompt, history, chosenModel);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("user_message", { id: userMsg.id, created_at: userMsg.created_at });
      send("route", {
        model: chosenModel,
        category: decision.category,
        complexity: decision.complexity,
        source: decision.source,
        reason: decision.reason,
        reasoning_effort: decision.reasoning_effort,
        routing_latency_ms: decision.routing_latency_ms,
        uncertain: decision.uncertain ?? false,
      });

      // ── Ветка image: вызываем images/generations, сохраняем картинку как attachment
      if (decision.category === "image") {
        const t0 = Date.now();
        try {
          const images = await generateImage({
            model: chosenModel,
            prompt: content,
            n: 1,
          });
          const durationMs = Date.now() - t0;
          const caption = `Готово · ${getModelLabel(chosenModel)}`;
          const attachmentsToSave = images.map((img, idx) => ({
            filename: `generated-${Date.now()}-${idx + 1}.png`,
            mime_type: img.mime,
            size: Math.floor((img.base64.length * 3) / 4),
            kind: "image" as const,
            content_base64: img.base64,
          }));

          const assistantMsg = await appendMessage(id, "assistant", caption, {
            model: chosenModel,
            durationMs,
            routeMeta: {
              category: decision.category,
              complexity: decision.complexity,
              source: decision.source,
              reason: decision.reason,
              reasoning_effort: decision.reasoning_effort,
              uncertain: decision.uncertain ?? false,
              routing_latency_ms: decision.routing_latency_ms,
            },
            attachments: attachmentsToSave,
          }).catch(async (err) => {
            await logServerError(err, "/api/chat/sessions/[id]/messages save image", { session_id: id });
            return null;
          });

          // Стримим изображения клиенту в SSE.
          for (const img of images) {
            send("image", { base64: img.base64, mime: img.mime });
          }
          // И финальное событие done — клиент закрывает stream.
          send("done", {
            id: assistantMsg?.id ?? null,
            created_at: assistantMsg?.created_at ?? new Date().toISOString(),
            model: chosenModel,
            usage: null,
            duration_ms: durationMs,
            route: {
              category: decision.category,
              complexity: decision.complexity,
              source: decision.source,
              reason: decision.reason,
              reasoning_effort: decision.reasoning_effort,
              uncertain: decision.uncertain ?? false,
              routing_latency_ms: decision.routing_latency_ms,
            },
            content: caption,
          });
          await setSessionLastModel(id, uid, chosenModel).catch(() => {});
        } catch (err) {
          let message = "AI image-gen failed";
          let status: number | undefined;
          if (err instanceof AIError) {
            message = err.message;
            status = err.status;
          } else if (err instanceof Error) {
            message = err.message;
          }
          const error_id = await logServerError(err, "/api/chat/sessions/[id]/messages image", {
            session_id: id,
            model: chosenModel,
            status,
          });
          send("error", { message, error_id });
        }
        controller.close();
        return;
      }

      // ── Ветка ансамбля: для research/code/analyze/strategy запускаем
      //   2-3 модели параллельно и судью (GPT-5 high). Пропускаем, если
      //   пользователь явно зафиксировал модель — override-model значит
      //   «хочу именно эту модель», а не «синтезированный микс».
      const ensembleModels = ENSEMBLES[decision.category];
      const shouldEnsemble =
        ensembleModels !== null &&
        ensembleModels.length > 1 &&
        decision.source !== "override-model";

      if (shouldEnsemble) {
        const t0 = Date.now();
        const buildMessages = (modelId: string) =>
          buildMessagesForModel(systemPrompt, history, modelId);

        // Дедупликация изображений/цитат для случая, если кто-то из кандидатов
        // (Perplexity Sonar) их вернёт в стриме судьи. На текущей реализации
        // судья — GPT-5 без поиска, так что обычно пусто.
        const seenImages = new Set<string>();
        const collectedImages: WebImage[] = [];
        const seenCitations = new Set<string>();
        const collectedCitations: WebCitation[] = [];

        let acc = "";
        let judgeTokens = 0;
        const judgeUsageRef: {
          current: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
        } = { current: null };

        try {
          const result = await runEnsemble(
            {
              models: ensembleModels,
              buildMessages,
              originalUserText: content,
              candidateMaxTokens: decision.max_tokens,
            },
            {
              onEnsembleStart: (models) => send("ensemble_start", { models }),
              onCandidateDone: (model, duration_ms, tokens) =>
                send("candidate_done", { model, duration_ms, tokens }),
              onCandidateError: (model, message) =>
                send("candidate_error", { model, message }),
              onJudgeStart: (model) => send("judge_start", { model }),
              onJudgeDelta: (text) => {
                acc += text;
                send("delta", { text });
              },
              onJudgeUsage: (u) => {
                judgeUsageRef.current = u;
                judgeTokens = u.completion_tokens;
              },
            },
          );

          const durationMs = Date.now() - t0;

          if (result.allFailed) {
            const error_id = await logServerError(
              new Error("ensemble: all candidates failed"),
              "/api/chat/sessions/[id]/messages ensemble",
              {
                session_id: id,
                category: decision.category,
                models: ensembleModels,
                candidate_errors: result.candidates.map((c) => ({
                  model: c.model,
                  error: c.error,
                })),
              },
            );
            send("error", {
              message: "Все модели упали — попробуйте ещё раз.",
              error_id,
            });
            controller.close();
            return;
          }

          if (!acc.trim()) {
            const error_id = await logServerError(
              new Error("ensemble: judge returned empty content"),
              "/api/chat/sessions/[id]/messages ensemble",
              { session_id: id, category: decision.category },
            );
            send("error", { message: "Судья вернул пустой ответ.", error_id });
            controller.close();
            return;
          }

          const routeMeta: RouteMeta = {
            category: decision.category,
            complexity: decision.complexity,
            source: decision.source,
            reason: decision.reason,
            reasoning_effort: decision.reasoning_effort,
            uncertain: decision.uncertain ?? false,
            routing_latency_ms: decision.routing_latency_ms,
            ensemble: true,
            candidates: result.candidates.map((c) => ({
              model: c.model,
              duration_ms: c.duration_ms,
              tokens: c.tokens,
              response: c.response,
              error: c.error ?? null,
            })),
            judge: {
              model: result.judge.model,
              duration_ms: result.judge.duration_ms,
              tokens: result.judge.tokens,
            },
            total_duration_ms: result.total_duration_ms,
          };

          const assistantMsg = await appendMessage(id, "assistant", acc, {
            // «model» для дисплея — судья. Это то, что финально отвечало.
            model: result.judge.model,
            tokensPrompt: judgeUsageRef.current?.prompt_tokens ?? null,
            tokensCompletion: judgeUsageRef.current?.completion_tokens ?? judgeTokens,
            durationMs,
            routeMeta,
          }).catch(async (err) => {
            await logServerError(err, "/api/chat/sessions/[id]/messages save ensemble", {
              session_id: id,
            });
            return null;
          });

          await setSessionLastModel(id, uid, result.judge.model).catch(() => {});

          send("done", {
            id: assistantMsg?.id ?? null,
            created_at: assistantMsg?.created_at ?? new Date().toISOString(),
            model: result.judge.model,
            usage: judgeUsageRef.current,
            duration_ms: durationMs,
            route: routeMeta,
            web_images: collectedImages,
            citations: collectedCitations,
          });
          controller.close();
          return;
        } catch (err) {
          let message = "Ensemble request failed";
          let status: number | undefined;
          if (err instanceof AIError) {
            message = err.message;
            status = err.status;
          } else if (err instanceof Error) {
            message = err.message;
          }
          const error_id = await logServerError(err, "/api/chat/sessions/[id]/messages ensemble", {
            session_id: id,
            category: decision.category,
            status,
          });
          send("error", { message, error_id });
          controller.close();
          return;
        }
      }

      // ── Ветка текстовая (chatStream) — одна модель
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const aimlOpts: any = {
        model: chosenModel,
        messages: aiMessages,
        max_tokens: decision.max_tokens,
      };
      // reasoning_effort пробрасываем только для моделей, которые его поддерживают
      // (gpt-5*, grok-4*, deepseek-reasoner-*). AIMLAPI игнорирует на остальных,
      // но лучше не отправлять «мусор».
      if (decision.reasoning_effort && isReasoningCapable(chosenModel)) {
        aimlOpts.reasoning_effort = decision.reasoning_effort;
      }
      // Для Perplexity Sonar в research-категории просим вернуть картинки
      // из источников и связанные ссылки — отрендерим под ответом.
      const isSearchModel = chosenModel.startsWith("perplexity/");
      if (isSearchModel && decision.category === "research") {
        aimlOpts.return_images = true;
        aimlOpts.return_related_questions = false;
      }

      const t0 = Date.now();
      let acc = "";
      const usageRef: { current: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null } =
        { current: null };
      // Дедупликация: модель может прислать одни и те же images/citations
      // несколько раз — в разных chunks. Храним set по URL.
      const seenImages = new Set<string>();
      const collectedImages: WebImage[] = [];
      const seenCitations = new Set<string>();
      const collectedCitations: WebCitation[] = [];

      try {
        await chatStream(aimlOpts, {
          onDelta: (text) => {
            acc += text;
            send("delta", { text });
          },
          onUsage: (u) => {
            usageRef.current = u;
          },
          onImages: (imgs) => {
            const fresh: WebImage[] = [];
            for (const img of imgs) {
              if (seenImages.has(img.image_url)) continue;
              seenImages.add(img.image_url);
              collectedImages.push(img);
              fresh.push(img);
            }
            if (fresh.length) send("web_images", { images: fresh });
          },
          onCitations: (cits) => {
            const fresh: WebCitation[] = [];
            for (const c of cits) {
              if (seenCitations.has(c.url)) continue;
              seenCitations.add(c.url);
              collectedCitations.push(c);
              fresh.push(c);
            }
            if (fresh.length) send("citations", { citations: fresh });
          },
        });
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
          model: chosenModel,
          status,
        });
        send("error", { message, error_id });
        controller.close();
        return;
      }

      const durationMs = Date.now() - t0;

      if (!acc.trim()) {
        const error_id = await logServerError(
          new Error("empty response from model"),
          "/api/chat/sessions/[id]/messages",
          { session_id: id, model: chosenModel },
        );
        send("error", { message: "Модель вернула пустой ответ.", error_id });
        controller.close();
        return;
      }

      const routeMeta: RouteMeta = {
        category: decision.category,
        complexity: decision.complexity,
        source: decision.source,
        reason: decision.reason,
        reasoning_effort: decision.reasoning_effort,
        uncertain: decision.uncertain ?? false,
        routing_latency_ms: decision.routing_latency_ms,
      };

      // Веб-картинки от Perplexity сохраняем как attachments kind='image_url',
      // URL кладём в content_text. Не скачиваем — экономим место + быстрее.
      const webImageAttachments = collectedImages.slice(0, 8).map((img, i) => ({
        filename: img.title ? img.title.slice(0, 100) : `web-image-${i + 1}`,
        mime_type: "image/*",
        size: 0,
        kind: "image_url" as const,
        content_text: img.image_url,
      }));

      const assistantMsg = await appendMessage(id, "assistant", acc, {
        model: chosenModel,
        tokensPrompt: usageRef.current?.prompt_tokens ?? null,
        tokensCompletion: usageRef.current?.completion_tokens ?? null,
        durationMs,
        routeMeta,
        attachments: webImageAttachments.length ? webImageAttachments : undefined,
      }).catch(async (err) => {
        await logServerError(err, "/api/chat/sessions/[id]/messages save assistant", { session_id: id });
        return null;
      });

      await setSessionLastModel(id, uid, chosenModel).catch(() => {});

      send("done", {
        id: assistantMsg?.id ?? null,
        created_at: assistantMsg?.created_at ?? new Date().toISOString(),
        model: chosenModel,
        usage: usageRef.current,
        duration_ms: durationMs,
        route: routeMeta,
        web_images: collectedImages.slice(0, 8),
        citations: collectedCitations.slice(0, 20),
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

/** Поддерживает ли модель параметр reasoning_effort. */
function isReasoningCapable(modelId: string): boolean {
  return (
    modelId.startsWith("gpt-5") ||
    modelId.includes("grok-4") ||
    modelId.includes("deepseek-reasoner") ||
    modelId.includes("deepseek-thinking")
  );
}

function getModelLabel(modelId: string): string {
  // Хорошо бы тянуть из MODEL_OPTIONS, но из server-route это создаст
  // зависимость; здесь достаточно lookup по последнему сегменту.
  const last = modelId.split("/").pop() ?? modelId;
  return last;
}
