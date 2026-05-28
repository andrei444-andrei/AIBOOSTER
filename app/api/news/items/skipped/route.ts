import { NextResponse } from "next/server";
import { checkAdminToken } from "@/lib/auth";
import { logServerError } from "@/lib/logger";
import { listItems } from "@/lib/news";
import { serializeItem } from "@/lib/news-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/news/items/skipped?limit=N
// Удобный shortcut для секции "Отсеяно" — те же items, но verdict=skip.
export async function GET(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get("limit"), 50);
  try {
    const items = await listItems({ verdict: "skip", limit });
    return NextResponse.json({ count: items.length, items: items.map(serializeItem) });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/items/skipped");
    return NextResponse.json({ error: "failed", error_id }, { status: 500 });
  }
}

function parseLimit(raw: string | null, def: number): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, 500);
}
