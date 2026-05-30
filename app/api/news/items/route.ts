import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import {
  listItems,
  listEnrichmentsForItems,
  bulkEnqueueEnrichmentsForItems,
  type NewsItemVerdict,
} from "@/lib/news";
import { serializeItem } from "@/lib/news-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/news/items?verdict=show|borderline|skip|all&limit=N
// По умолчанию verdict=show, limit=50. Лента — валидированные посты.
// Дополнительно:
//   - inline-возврат enrichment-данных (любого статуса) для каждой карточки
//   - auto-enqueue (bulk) показов без enrichment-записи, чтобы пользователь
//     не должен был вручную нажимать «собрать»
export async function GET(req: Request) {
  const url = new URL(req.url);
  const verdictRaw = url.searchParams.get("verdict") ?? "show";
  const ALLOWED = new Set(["show", "borderline", "skip", "all"]);
  if (!ALLOWED.has(verdictRaw)) {
    return NextResponse.json({ error: `invalid verdict: ${verdictRaw}` }, { status: 400 });
  }
  const verdict = verdictRaw as NewsItemVerdict | "all";
  const limit = parseLimit(url.searchParams.get("limit"), 50);
  // По умолчанию исключаем прочитанные — после like/dislike карточка уходит
  // во вкладку «прочитанное». Можно отключить через ?include_read=1.
  const excludeRead = url.searchParams.get("include_read") !== "1";

  try {
    const items = await listItems({ verdict, limit, excludeRead });
    const itemIds = items.map((it) => it.id);

    // Auto-enqueue для show-постов без enrichment-записи. Идемпотентно.
    if (verdict === "show" || verdict === "all") {
      try {
        await bulkEnqueueEnrichmentsForItems(
          items
            .filter((it) => it.verdict === "show")
            .map((it) => ({ id: it.id, title: it.title, body: it.body })),
        );
      } catch (err) {
        // Не валим запрос если auto-enqueue упал.
        await logServerError(err, "/api/news/items:bulk_enqueue");
      }
    }

    const enrichments = await listEnrichmentsForItems(itemIds);
    return NextResponse.json({
      count: items.length,
      items: items.map((it) => {
        const e = enrichments.get(it.id);
        return {
          ...serializeItem(it),
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
    const error_id = await logServerError(err, "/api/news/items");
    return NextResponse.json(
      { error: "failed to list items", error_id },
      { status: 500 },
    );
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
