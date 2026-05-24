import { NextResponse } from "next/server";
import { startRun } from "@/lib/scraper/orchestrator";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// LLM-вызов может занять до 30 сек, плюс старт Apify. Стандартный лимит Vercel
// Hobby — 10 сек, Pro — 60 сек. Запрашиваем 60.
export const maxDuration = 60;

/**
 * POST /api/scraper/run
 * Body: { prompt: string }
 * Response: { runId: string } | { error: { message, error_id } }
 */
export async function POST(req: Request) {
  let body: { prompt?: string };
  try {
    body = (await req.json()) as { prompt?: string };
  } catch {
    return NextResponse.json(
      { error: { message: "Невалидный JSON в теле запроса" } },
      { status: 400 },
    );
  }

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) {
    return NextResponse.json(
      { error: { message: "Поле 'prompt' пустое" } },
      { status: 400 },
    );
  }

  try {
    const runId = await startRun(prompt);
    return NextResponse.json({ runId });
  } catch (err) {
    const errorId = await logServerError(err, "/api/scraper/run", { prompt });
    const message =
      err instanceof Error ? err.message : "Внутренняя ошибка сервера";
    return NextResponse.json(
      { error: { message, error_id: errorId } },
      { status: 500 },
    );
  }
}
