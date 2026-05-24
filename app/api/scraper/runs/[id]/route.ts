import { NextResponse } from "next/server";
import { getRunView } from "@/lib/scraper/orchestrator";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/scraper/runs/[id]
 * Возвращает полное состояние run-а. Если запуск ещё идёт — попутно
 * опрашивает Apify и продвигает статус.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json(
      { error: { message: "Не указан id запуска" } },
      { status: 400 },
    );
  }

  try {
    const view = await getRunView(id);
    if (!view) {
      return NextResponse.json(
        { error: { message: "Запуск не найден" } },
        { status: 404 },
      );
    }
    return NextResponse.json(view);
  } catch (err) {
    const errorId = await logServerError(err, "/api/scraper/runs/[id]", {
      id,
    });
    return NextResponse.json(
      {
        error: {
          message: err instanceof Error ? err.message : "Внутренняя ошибка",
          error_id: errorId,
        },
      },
      { status: 500 },
    );
  }
}
