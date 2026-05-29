import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { getSource } from "@/lib/news";
import { processSourceNow } from "@/lib/news-pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/news/sources/fetch-one { id }
// Ручной триггер парсинга одного источника. Независим от cron-tick'а:
// просто тянет посты с Telegram t.me/s/ или RSS, вставляет новые в БД.
// Валидация Sonnet'ом происходит в следующем cron-тике (или вручную через
// /api/news/cron/tick). Так "добавление источника" и "парсинг" разнесены.
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const source = await getSource(id);
    if (!source) {
      return NextResponse.json({ error: "source not found" }, { status: 404 });
    }
    const res = await processSourceNow(source);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/sources/fetch-one", { id });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed", error_id },
      { status: 500 },
    );
  }
}
