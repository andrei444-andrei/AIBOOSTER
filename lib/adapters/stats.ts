// Сводная статистика по сниппетам в context_snippets — для админки и главной.
//
// Один запрос на все источники: COUNT(*) + сколько появилось за последние 24ч.
// При пустой/новой БД возвращаем нули, а не падаем.

import { getDb, ensureSchema } from "../db";
import type { AdapterKind } from "./types";

export interface SourceStats {
  total: number;
  last24h: number;
}

export interface ContextStats {
  total: number;
  last24h: number;
  bySource: Partial<Record<AdapterKind, SourceStats>>;
}

const EMPTY: ContextStats = { total: 0, last24h: 0, bySource: {} };

export async function getContextStats(): Promise<ContextStats> {
  try {
    await ensureSchema();
    const db = getDb();
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const res = await db.execute({
      sql: `SELECT source,
                   COUNT(*) AS total,
                   SUM(CASE WHEN fetched_at >= ? THEN 1 ELSE 0 END) AS last24h
            FROM context_snippets
            GROUP BY source`,
      args: [dayAgo],
    });

    const bySource: Partial<Record<AdapterKind, SourceStats>> = {};
    let total = 0;
    let last24h = 0;
    for (const row of res.rows as unknown as Array<{
      source: string;
      total: number;
      last24h: number;
    }>) {
      const t = Number(row.total) || 0;
      const d = Number(row.last24h) || 0;
      bySource[row.source as AdapterKind] = { total: t, last24h: d };
      total += t;
      last24h += d;
    }
    return { total, last24h, bySource };
  } catch {
    return EMPTY;
  }
}
