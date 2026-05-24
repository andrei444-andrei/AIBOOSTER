import { NextResponse } from "next/server";
import { checkAdminToken } from "@/lib/auth";
import { syncCatalog } from "@/lib/scraper/catalog";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Sync ходит в Apify Store API + N LLM-вызовов батчами. На лимите Vercel
// (60 сек) укладываемся для ~50 актеров. Под бо́льшие объёмы — несколько
// итераций или повышенный план.
export const maxDuration = 60;

/**
 * POST /api/admin/scraper/sync-catalog?limit=N&minUsers=M&token=...
 *
 * Запускает обогащение каталога:
 *  - limit (default 50)     — сколько актеров загнать за вызов (cap 500).
 *  - minUsers (default 100) — порог пользователей для отсева мусора.
 *
 * Возвращает { fetched, filtered, upserted, failed, errors }.
 */
export async function POST(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const url = new URL(req.url);
  const limit = clampInt(url.searchParams.get("limit"), 1, 500, 50);
  const minUsers = clampInt(url.searchParams.get("minUsers"), 0, 100_000, 100);

  try {
    const result = await syncCatalog({ limit, minUsers });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const errorId = await logServerError(err, "/api/admin/scraper/sync-catalog");
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "internal error",
        error_id: errorId,
      },
      { status: 500 },
    );
  }
}

function clampInt(
  raw: string | null,
  min: number,
  max: number,
  def: number,
): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}
