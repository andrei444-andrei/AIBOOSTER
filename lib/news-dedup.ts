// Дедупликация ленты: одна и та же история приходит из 5 источников →
// показываем только канонический item, остальные — как «+N похожих» под ним.
//
// Подход: эмбеддинг title+lead (или title+summary) → cosine similarity → если
// >= THRESHOLD относительно уже существующего cluster_id — присваиваем тот же.
// Иначе новый cluster_id (UUID).
//
// Считаем embedding'и лениво при чтении ленты: для validated show items без
// embedding'а. Один request на батч (быстро + дёшево).

import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "./db";
import { embedBatch, cosineSim } from "./embedding";
import { logServerError } from "./logger";
import type { ItemWithSource } from "./news";

/** Cosine ≥ 0.82 = «то же событие, разными словами». Подобрано эмпирически:
 *  same-event пары обычно 0.85-0.95; разные истории про AI ≈ 0.5-0.7. */
const CLUSTER_SIM_THRESHOLD = 0.82;

/** Сколько недавних items вытаскиваем для поиска кластера-кандидата. Глубже
 *  ходить смысла нет — старее 7 дней маловероятно дубликат свежей новости. */
const DEDUP_LOOKBACK_DAYS = 7;
const DEDUP_LOOKBACK_LIMIT = 300;

interface DedupCandidate {
  id: string;
  embedding: number[];
  cluster_id: string | null;
}

interface ItemRow {
  id: string;
  title: string | null;
  summary: string | null;
  body: string | null;
  title_embedding: string | null;
  cluster_id: string | null;
}

function embedSource(item: { title: string | null; summary: string | null; body: string | null }): string {
  const parts: string[] = [];
  if (item.title) parts.push(item.title);
  if (item.summary) parts.push(item.summary);
  else if (item.body) parts.push(item.body.slice(0, 400));
  return parts.join(" — ").trim();
}

/** Возвращает (для тех items, у кого ещё нет embedding'а) свежие embeddings,
 *  кластеризует относительно последних DEDUP_LOOKBACK_LIMIT items и
 *  пишет обратно title_embedding + cluster_id. Идемпотентно. */
export async function backfillDedupForItems(itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  await ensureSchema();
  const db = getDb();
  // 1. Только те, у кого embedding'а ещё нет.
  const placeholders = itemIds.map(() => "?").join(",");
  const targetsRes = await db.execute({
    sql: `SELECT id, title, summary, body, title_embedding, cluster_id
          FROM news_items
          WHERE id IN (${placeholders}) AND title_embedding IS NULL`,
    args: itemIds,
  });
  const targets = targetsRes.rows as unknown as ItemRow[];
  if (targets.length === 0) return;

  // 2. Эмбеддинги — одним запросом.
  const texts = targets.map(embedSource);
  let embeddings: number[][];
  try {
    embeddings = await embedBatch(texts);
  } catch (err) {
    await logServerError(err, "news-dedup:embedBatch");
    return;
  }

  // 3. Кандидаты для сравнения — все embedded items за последние 7 дней.
  const lookbackIso = new Date(Date.now() - DEDUP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const candRes = await db.execute({
    sql: `SELECT id, title_embedding, cluster_id
          FROM news_items
          WHERE title_embedding IS NOT NULL
            AND status = 'validated'
            AND verdict = 'show'
            AND created_at > ?
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [lookbackIso, DEDUP_LOOKBACK_LIMIT],
  });
  const candidates: DedupCandidate[] = [];
  for (const row of candRes.rows as unknown as Array<{ id: string; title_embedding: string; cluster_id: string | null }>) {
    try {
      const v = JSON.parse(row.title_embedding);
      if (Array.isArray(v) && v.length > 0) {
        candidates.push({ id: row.id, embedding: v, cluster_id: row.cluster_id });
      }
    } catch {
      // битый JSON — пропускаем
    }
  }

  // 4. Для каждого target ищем лучший кластер; если найден — присваиваем,
  //    иначе создаём новый UUID-кластер.
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const emb = embeddings[i];
    if (!emb || emb.length === 0) continue;
    let bestClusterId: string | null = null;
    let bestSim = 0;
    for (const c of candidates) {
      if (c.id === t.id) continue;
      const sim = cosineSim(emb, c.embedding);
      if (sim >= CLUSTER_SIM_THRESHOLD && sim > bestSim) {
        bestSim = sim;
        bestClusterId = c.cluster_id ?? c.id; // если у кандидата нет cluster_id, он сам становится корнем
      }
    }
    const finalClusterId = bestClusterId ?? randomUUID();
    const embJson = JSON.stringify(emb);
    await db.execute({
      sql: `UPDATE news_items SET title_embedding = ?, cluster_id = ? WHERE id = ?`,
      args: [embJson, finalClusterId, t.id],
    });
    // Добавляем новопосчитанный в candidates — следующий target в этом же
    // батче должен видеть его как кандидата (например, два одинаковых
    // прилетели одновременно).
    candidates.unshift({ id: t.id, embedding: emb, cluster_id: finalClusterId });
  }
}

/** Группирует уже отсортированный по дате массив items в кластеры. Первый
 *  встретившийся item в каждом кластере становится каноническим, остальные
 *  попадают в его related. Items без cluster_id обрабатываются как
 *  одиночные (кластер = их id). */
export interface ClusteredItem<T extends { id: string; cluster_id?: string | null }> {
  canonical: T;
  related: T[];
}

export function groupByCluster<T extends { id: string; cluster_id?: string | null }>(
  items: T[],
): ClusteredItem<T>[] {
  const seen = new Map<string, ClusteredItem<T>>();
  for (const it of items) {
    const key = it.cluster_id || it.id;
    const existing = seen.get(key);
    if (existing) {
      existing.related.push(it);
    } else {
      seen.set(key, { canonical: it, related: [] });
    }
  }
  return Array.from(seen.values());
}
