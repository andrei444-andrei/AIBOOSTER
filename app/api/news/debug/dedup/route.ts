import { NextResponse } from "next/server";
import { getDb, ensureSchema } from "@/lib/db";
import { embedBatch } from "@/lib/embedding";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/news/debug/dedup — диагностика дедупликации.
// Без auth — single-user проект, продуктовых данных не светит.
export async function GET() {
  await ensureSchema();
  const db = getDb();
  const stats = await db.execute(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN title_embedding IS NOT NULL THEN 1 ELSE 0 END) AS embedded,
      SUM(CASE WHEN cluster_id IS NOT NULL THEN 1 ELSE 0 END) AS clustered
    FROM news_items
    WHERE status='validated' AND verdict='show' AND COALESCE(archived,0)=0
  `);
  const r = stats.rows[0] ?? {};
  // Кластеры со >1 членом
  const clusters = await db.execute(`
    SELECT cluster_id, COUNT(*) AS n
    FROM news_items
    WHERE cluster_id IS NOT NULL AND status='validated' AND verdict='show'
    GROUP BY cluster_id
    HAVING n > 1
    ORDER BY n DESC
    LIMIT 10
  `);
  const multi = clusters.rows;

  // Простой self-test эмбеддингов
  let embed_test: unknown;
  try {
    const t0 = Date.now();
    const out = await embedBatch(["hello world", "test embedding"]);
    embed_test = {
      ok: true,
      dims: out[0]?.length ?? 0,
      latency_ms: Date.now() - t0,
    };
  } catch (err) {
    embed_test = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json({
    items_total: Number(r.total ?? 0),
    items_embedded: Number(r.embedded ?? 0),
    items_clustered: Number(r.clustered ?? 0),
    multi_member_clusters: multi.length,
    top_clusters: multi.map((c: Record<string, unknown>) => ({ cluster_id: c.cluster_id, n: Number(c.n) })),
    embed_test,
  });
}
