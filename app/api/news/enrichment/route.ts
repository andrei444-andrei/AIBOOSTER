import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { getEnrichmentByItem, enqueueEnrichment, getItem } from "@/lib/news";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/news/enrichment?item_id=...
// Возвращает enrichment (если есть) для конкретного поста.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const itemId = u.searchParams.get("item_id");
  if (!itemId) return NextResponse.json({ error: "item_id required" }, { status: 400 });
  try {
    const row = await getEnrichmentByItem(itemId);
    if (!row) return NextResponse.json({ enrichment: null });
    return NextResponse.json({
      enrichment: {
        id: row.id,
        status: row.status,
        // Полный текст статьи (article_body) лежит в synthesized_summary.
        article_body: row.synthesized_summary,
        key_facts: parseJsonArr(row.key_facts_json),
        sources_used: parseSources(row.sources_used_json),
        images: parseImages(row.images_json),
        original_source_url: row.original_source_url,
        // Полный JSON-ответ для отладочной панели (headline/lead/quotes/timeline/implications)
        synthesis_output_json: row.synthesis_output_json,
        model_used: row.model_used,
        cost_cents: row.cost_cents,
        latency_ms: row.latency_ms,
        created_at: row.created_at,
        completed_at: row.completed_at,
        synthesis_error: row.synthesis_error,
      },
    });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/enrichment");
    return NextResponse.json({ error: "failed", error_id }, { status: 500 });
  }
}

// POST /api/news/enrichment { item_id, force? }
// Ручной триггер. force=true сбрасывает 'done' в 'pending' — для
// принудительной пересборки старого enrichment'а с новой версией pipeline.
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const itemId = typeof body.item_id === "string" ? body.item_id : "";
  const force = body.force === true;
  if (!itemId) return NextResponse.json({ error: "item_id required" }, { status: 400 });

  try {
    const item = await getItem(itemId);
    if (!item) return NextResponse.json({ error: "item not found" }, { status: 404 });
    const query = item.title || item.body?.slice(0, 200) || "";
    if (!query.trim()) {
      return NextResponse.json({ error: "item has no title or body to query on" }, { status: 400 });
    }
    if (force) {
      // Сбрасываем status='done' в 'pending', чтобы pipeline пересобрал.
      const { resetEnrichmentToPending } = await import("@/lib/news");
      await resetEnrichmentToPending(itemId, query);
      return NextResponse.json({ ok: true, queued: true, note: "force-resync, поставлено в очередь" });
    }
    const inserted = await enqueueEnrichment(itemId, query);
    return NextResponse.json({
      ok: true,
      queued: inserted,
      note: inserted ? "поставлено в очередь" : "уже есть запись для этого поста (не пере-перезапускаем)",
    });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/enrichment POST");
    return NextResponse.json({ error: "failed", error_id }, { status: 500 });
  }
}

function parseJsonArr(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseSources(
  s: string | null,
): Array<{ url: string; title: string; role?: string; why_relevant: string }> {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function parseImages(s: string | null): Array<{ url: string; caption: string; source_url: string }> {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
