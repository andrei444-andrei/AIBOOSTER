import { NextResponse } from "next/server";
import { listCatalog, listCategories } from "@/lib/scraper/catalog";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/scraper/catalog?category=...&limit=...
 * Публичный — это UX-помощник, не данные.
 *
 * Возвращает { categories: [{category_ru, count}], items: [...] }
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get("category") || undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? parseInt(limitRaw, 10) : 200;

  try {
    const [items, categories] = await Promise.all([
      listCatalog({ category, limit }),
      listCategories(),
    ]);
    // Распарсим JSON-поля для удобства фронта.
    const decoded = items.map((it) => ({
      ...it,
      target_sites: safeJson<string[]>(it.target_sites) ?? [],
      example_prompts:
        safeJson<Array<{ label: string; prompt: string }>>(
          it.example_prompts,
        ) ?? [],
    }));
    return NextResponse.json({ categories, items: decoded });
  } catch (err) {
    const errorId = await logServerError(err, "/api/scraper/catalog");
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "internal error",
        error_id: errorId,
      },
      { status: 500 },
    );
  }
}

function safeJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
