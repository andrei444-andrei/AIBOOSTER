import { NextResponse } from "next/server";
import { getDb, ensureSchema } from "@/lib/db";
import { normalizeRssItem } from "@/lib/rss";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST/GET /api/news/admin/normalize-titles
// Одноразовый backfill: для items с title.length > 160 применяем
// normalizeRssItem и переписываем title + (если body короче overflow) body.
// Идемпотентно — повторный вызов нормализованного item ничего не меняет.
async function handle() {
  try {
    await ensureSchema();
    const db = getDb();
    const res = await db.execute(`
      SELECT id, title, body FROM news_items
      WHERE title IS NOT NULL AND length(title) > 160
      LIMIT 500
    `);
    const rows = res.rows as unknown as Array<{ id: string; title: string; body: string | null }>;
    let updated = 0;
    const examples: Array<{ id: string; before: string; after: string }> = [];
    for (const r of rows) {
      const normalized = normalizeRssItem({
        external_id: r.id,
        url: "",
        title: r.title,
        body: r.body ?? "",
        published_at: null,
        raw_meta: {},
      });
      if (normalized.title === r.title) continue;
      await db.execute({
        sql: `UPDATE news_items SET title = ?, body = ? WHERE id = ?`,
        args: [normalized.title ?? r.title, normalized.body || r.body, r.id],
      });
      updated++;
      if (examples.length < 5) {
        examples.push({
          id: r.id,
          before: r.title.slice(0, 100) + (r.title.length > 100 ? "…" : ""),
          after: normalized.title ?? "(none)",
        });
      }
    }
    return NextResponse.json({
      ok: true,
      scanned: rows.length,
      updated,
      examples,
    });
  } catch (err) {
    const error_id = await logServerError(err, "news/admin/normalize-titles");
    return NextResponse.json({ ok: false, error_id }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
