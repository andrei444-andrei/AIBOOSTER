import { NextResponse } from "next/server";
import { checkAdminToken } from "@/lib/auth";
import { chatText, AIError, DEFAULT_MODEL } from "@/lib/ai";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Smoke-проверка шлюза AIMLAPI (§4): отдаёт один маленький промт указанной
// модели и возвращает ответ. Защищена admin-токеном — это не публичный
// сервис, а инструмент для проверки конфигурации.
//
// Использование:
//   GET /api/admin/ai-ping?token=...&model=gpt-5&prompt=ping
//
// Если model не указан — берём GPT_5 по умолчанию.
// Если prompt не указан — фиксированный микро-промт.
export async function GET(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.reason, message: auth.reason } },
      { status: auth.status }
    );
  }

  const url = new URL(req.url);
  const model = url.searchParams.get("model") || DEFAULT_MODEL;
  const prompt =
    url.searchParams.get("prompt") ||
    'Ответь одним словом "pong". Ничего больше не пиши.';
  // Для reasoning-моделей (gpt-5*) нужно больше токенов на скрытые рассуждения.
  const maxTokens = /gpt-5/.test(model) ? 1200 : 200;

  const t0 = Date.now();
  try {
    const output = await chatText({
      model,
      user: prompt,
      max_tokens: maxTokens,
    });
    return NextResponse.json({
      ok: true,
      model,
      prompt,
      output,
      took_ms: Date.now() - t0,
    });
  } catch (err) {
    const error_id = await logServerError(err, "/api/admin/ai-ping", { model, prompt });

    if (err instanceof AIError) {
      return NextResponse.json(
        {
          error: {
            code: "aimlapi_error",
            message: err.message,
            error_id,
          },
          upstream_status: err.status,
          upstream_body: err.body?.slice(0, 1000) ?? null,
        },
        { status: err.status >= 400 && err.status < 600 ? err.status : 502 }
      );
    }

    return NextResponse.json(
      {
        error: {
          code: "internal_error",
          message: err instanceof Error ? err.message : String(err),
          error_id,
        },
      },
      { status: 500 }
    );
  }
}
