import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { listReadItems, listEnrichmentsForItems } from "@/lib/news";
import { serializeItem } from "@/lib/news-serialize";
import { backfillDedupForItems } from "@/lib/news-dedup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/news/items/read?limit=N
// Прочитанные карточки: те, по которым уже есть like/dislike/hide. Сортировка
// по времени последнего фидбэка (свежие сверху).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get("limit"), 100);
  try {
    const items = await listReadItems(limit);
    const itemIds = items.map((it) => it.id);
    // Бэкфилл — на случай если в read попало что-то без embedding'а.
    // Не критично, лучшее-effort.
    try {
      await backfillDedupForItems(itemIds);
    } catch (err) {
      await logServerError(err, "/api/news/items/read:dedup_backfill");
    }
    const enrichments = await listEnrichmentsForItems(itemIds);
    return NextResponse.json({
      count: items.length,
      items: items.map((it) => {
        const e = enrichments.get(it.id);
        return {
          ...serializeItem(it),
          feedback_signal: it.feedback_signal,
          feedback_at: it.feedback_at,
          enrichment: e
            ? {
                status: e.status,
                article_body: e.synthesized_summary,
                key_facts: parseStrArr(e.key_facts_json),
                images: parseImages(e.images_json),
                sources_used: parseSources(e.sources_used_json),
                original_source_url: e.original_source_url,
                model_used: e.model_used,
                cost_cents: e.cost_cents,
                latency_ms: e.latency_ms,
                completed_at: e.completed_at,
                synthesis_error: e.synthesis_error,
                synthesis_output_json: e.synthesis_output_json,
              }
            : null,
        };
      }),
    });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/items/read");
    return NextResponse.json({ error: "failed to list read items", error_id }, { status: 500 });
  }
}

function parseLimit(raw: string | null, def: number): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, 500);
}

function parseStrArr(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
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
