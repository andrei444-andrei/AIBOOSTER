import { NextResponse } from "next/server";
import { checkAdminToken } from "@/lib/auth";
import { logServerError } from "@/lib/logger";
import { listItems, type NewsItemVerdict } from "@/lib/news";
import { serializeItem } from "@/lib/news-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/news/items?verdict=show|borderline|skip|all&limit=N
// По умолчанию verdict=show, limit=50. Лента — валидированные посты.
export async function GET(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const url = new URL(req.url);
  const verdictRaw = url.searchParams.get("verdict") ?? "show";
  const ALLOWED = new Set(["show", "borderline", "skip", "all"]);
  if (!ALLOWED.has(verdictRaw)) {
    return NextResponse.json({ error: `invalid verdict: ${verdictRaw}` }, { status: 400 });
  }
  const verdict = verdictRaw as NewsItemVerdict | "all";
  const limit = parseLimit(url.searchParams.get("limit"), 50);

  try {
    const items = await listItems({ verdict, limit });
    return NextResponse.json({
      count: items.length,
      items: items.map(serializeItem),
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
