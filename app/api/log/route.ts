import { NextResponse } from "next/server";
import { logError, type ErrorLevel } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/log — приём клиентских ошибок (source=client) в единый сток.
// Открыт без админ-токена намеренно: это вход для логирования с фронта, не
// чтение. Объём ввода ограничиваем, чтобы не злоупотребляли.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const level = normalizeLevel(body.level);
  const id = await logError({
    level,
    source: "client",
    route: typeof body.route === "string" ? body.route : null,
    message: message.slice(0, 4000),
    stack: typeof body.stack === "string" ? body.stack.slice(0, 16000) : null,
    build: typeof body.build === "string" ? body.build : null,
    userAgent: req.headers.get("user-agent"),
    meta: body.meta,
  });

  return NextResponse.json({ ok: true, error_id: id });
}

function normalizeLevel(value: unknown): ErrorLevel {
  return value === "warn" || value === "info" ? value : "error";
}
