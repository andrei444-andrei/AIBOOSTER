import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { getEnrichmentByItem } from "@/lib/news";

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
        summary: row.synthesized_summary,
        key_facts: parseJsonArr(row.key_facts_json),
        sources_used: parseSources(row.sources_used_json),
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

function parseJsonArr(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseSources(s: string | null): Array<{ url: string; title: string; why_relevant: string }> {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
