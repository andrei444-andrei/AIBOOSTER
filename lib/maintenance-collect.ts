// Сбор сигналов о состоянии системы для maintenance-агента.
// Идея — дать Opus компактную сводку (без сырых дампов БД), чтобы он
// мог решить, что чинить. Все детали — в БД, если агент захочет, может
// запросить конкретный target через action.

import { ensureSchema, getDb } from "./db";

export interface FailedEnrichmentSample {
  enrichment_id: string;
  item_id: string;
  item_title: string;
  source_name: string;
  source_id: string;
  error: string;
  retry_count: number;
  created_at: string;
  completed_at: string | null;
}

export interface SourceHealth {
  source_id: string;
  name: string;
  url: string;
  kind: string;
  active: number;
  last_fetched_at: string | null;
  total_items_24h: number;
  failed_enrich_24h: number;
  recent_errors: string[]; // топ-2 последних app_errors message
}

export interface RecentAppError {
  ts: string;
  level: string;
  route: string | null;
  message: string;
}

export interface MaintenanceSignals {
  collected_at: string;
  failed_enrichments: FailedEnrichmentSample[];
  failed_enrichments_total: number;
  stuck_running_enrichments: number; // status=running AND locked_until истёк
  source_health: SourceHealth[];
  broken_sources_404_or_403: SourceHealth[];
  recent_app_errors: RecentAppError[];
  enrichment_24h_total: number;
  enrichment_24h_success: number;
  enrichment_24h_failed: number;
}

export async function collectSignals(): Promise<MaintenanceSignals> {
  await ensureSchema();
  const db = getDb();

  // 1) FAILED enrichments — топ-15, свежее → старее.
  const failedRes = await db.execute(`
    SELECT e.id AS enrichment_id, e.item_id, e.synthesis_error AS error,
           COALESCE(e.retry_count, 0) AS retry_count,
           e.created_at, e.completed_at,
           i.title AS item_title,
           s.id AS source_id, s.name AS source_name
    FROM news_enrichments e
    JOIN news_items i ON i.id = e.item_id
    JOIN news_sources s ON s.id = i.source_id
    WHERE e.status = 'failed'
    ORDER BY COALESCE(e.completed_at, e.created_at) DESC
    LIMIT 15
  `);
  const failed_enrichments: FailedEnrichmentSample[] = (failedRes.rows as unknown as Array<{
    enrichment_id: string;
    item_id: string;
    error: string | null;
    retry_count: number;
    created_at: string;
    completed_at: string | null;
    item_title: string | null;
    source_id: string;
    source_name: string;
  }>).map((r) => ({
    enrichment_id: r.enrichment_id,
    item_id: r.item_id,
    item_title: (r.item_title ?? "").slice(0, 200),
    source_name: r.source_name,
    source_id: r.source_id,
    error: (r.error ?? "").slice(0, 500),
    retry_count: r.retry_count,
    created_at: r.created_at,
    completed_at: r.completed_at,
  }));

  // 2) Сколько всего failed.
  const totalFailedRes = await db.execute(`SELECT COUNT(*) AS n FROM news_enrichments WHERE status = 'failed'`);
  const failed_enrichments_total = Number((totalFailedRes.rows[0] as unknown as { n: number })?.n ?? 0);

  // 3) Stale-running.
  const stuckRes = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM news_enrichments
          WHERE status = 'running' AND (locked_until IS NULL OR locked_until < ?)`,
    args: [new Date().toISOString()],
  });
  const stuck_running_enrichments = Number((stuckRes.rows[0] as unknown as { n: number })?.n ?? 0);

  // 4) Source health.
  const sourcesRes = await db.execute(`
    SELECT id AS source_id, name, url, kind, active, last_fetched_at
    FROM news_sources
  `);
  const sources = sourcesRes.rows as unknown as Array<{
    source_id: string;
    name: string;
    url: string;
    kind: string;
    active: number;
    last_fetched_at: string | null;
  }>;

  const cutoff24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const source_health: SourceHealth[] = [];
  const broken: SourceHealth[] = [];
  for (const src of sources) {
    const itemsRes = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM news_items WHERE source_id = ? AND created_at > ?`,
      args: [src.source_id, cutoff24h],
    });
    const total_items_24h = Number((itemsRes.rows[0] as unknown as { n: number })?.n ?? 0);

    const failedRes2 = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM news_enrichments e
            JOIN news_items i ON i.id = e.item_id
            WHERE i.source_id = ? AND e.status = 'failed' AND e.created_at > ?`,
      args: [src.source_id, cutoff24h],
    });
    const failed_enrich_24h = Number((failedRes2.rows[0] as unknown as { n: number })?.n ?? 0);

    // Recent app_errors connected to this source URL/name.
    const errorsRes = await db.execute({
      sql: `SELECT message FROM app_errors
            WHERE message LIKE ? OR message LIKE ?
            ORDER BY ts DESC LIMIT 2`,
      args: [`%${src.name}%`, `%${src.url}%`],
    });
    const recent_errors = (errorsRes.rows as unknown as Array<{ message: string }>).map((r) => r.message.slice(0, 300));

    const health: SourceHealth = {
      source_id: src.source_id,
      name: src.name,
      url: src.url,
      kind: src.kind,
      active: src.active,
      last_fetched_at: src.last_fetched_at,
      total_items_24h,
      failed_enrich_24h,
      recent_errors,
    };
    source_health.push(health);

    // Considered broken if recent errors mention 404/403/timeout AND active=1 AND no items in 24h.
    const errorsConcat = recent_errors.join(" ").toLowerCase();
    const looksBroken =
      src.active === 1 &&
      total_items_24h === 0 &&
      (errorsConcat.includes("404") ||
        errorsConcat.includes("403") ||
        errorsConcat.includes("not found") ||
        errorsConcat.includes("forbidden") ||
        errorsConcat.includes("dns") ||
        errorsConcat.includes("timeout"));
    if (looksBroken) broken.push(health);
  }

  // 5) Recent app_errors (top 10).
  const aeRes = await db.execute(`
    SELECT ts, level, route, message
    FROM app_errors
    WHERE level IN ('error', 'warn')
    ORDER BY ts DESC, rowid DESC
    LIMIT 10
  `);
  const recent_app_errors: RecentAppError[] = (aeRes.rows as unknown as Array<{
    ts: string;
    level: string;
    route: string | null;
    message: string;
  }>).map((r) => ({
    ts: r.ts,
    level: r.level,
    route: r.route,
    message: r.message.slice(0, 500),
  }));

  // 6) 24h enrichment stats.
  const statsRes = await db.execute({
    sql: `SELECT
            SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS total,
            SUM(CASE WHEN status = 'done' AND created_at > ? THEN 1 ELSE 0 END) AS ok,
            SUM(CASE WHEN status = 'failed' AND created_at > ? THEN 1 ELSE 0 END) AS bad
          FROM news_enrichments`,
    args: [cutoff24h, cutoff24h, cutoff24h],
  });
  const stat = statsRes.rows[0] as unknown as { total: number; ok: number; bad: number };

  return {
    collected_at: new Date().toISOString(),
    failed_enrichments,
    failed_enrichments_total,
    stuck_running_enrichments,
    source_health,
    broken_sources_404_or_403: broken,
    recent_app_errors,
    enrichment_24h_total: Number(stat.total ?? 0),
    enrichment_24h_success: Number(stat.ok ?? 0),
    enrichment_24h_failed: Number(stat.bad ?? 0),
  };
}
