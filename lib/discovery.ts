// Discovery layer: вместо того чтобы ждать пока интересные новости САМИ
// просочатся через RSS-источники, мы каждые 6 часов запрашиваем у Perplexity
// «найди 5 самых важных статей за последние 7 дней по теме X» — для КАЖДОЙ
// активной темы из профиля пользователя.
//
// Найденные ссылки превращаем в news_items под синтетическим source'ом
// «Discovery (<topic>)»; дальше валидатор и enrichment их обработают как
// обычно. Из-за того что мы знаем title+snippet от Perplexity, валидатор
// сразу видит контекст и не штрафует за «пустое тело».
//
// Стоимость: ~$0.015 за 1 perplexity-запрос × ~10 тем × 4 раза в сутки ≈ $1.80/мес.

import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "./db";
import { perplexitySearch } from "./perplexity-search";
import { getActiveProfile } from "./news";
import { ensureEnglish } from "./translate-en";
import type { InterestTopic } from "./news-prompt";
import { logError } from "./logger";

export interface DiscoveryRunResult {
  topics_queried: number;
  hits_found: number;
  items_inserted: number;
  sources_created: number;
  duplicates_skipped: number;
  errors: string[];
  per_topic: Array<{ topic: string; hits: number; inserted: number; error?: string }>;
  cost_cents: number;
  latency_ms: number;
}

const MAX_HITS_PER_TOPIC = 5;
const MAX_TOPICS_PER_RUN = 12;
const TOPIC_TIMEOUT_MS = 25_000;

// Кладём все «найденные» item'ы под один синтетический source per-topic.
// Это нужно чтобы в UI было видно «Discovery: AI-агенты» как происхождение.
async function ensureDiscoverySource(topicName: string): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const url = `discovery://topic/${encodeURIComponent(topicName)}`;
  const existing = await db.execute({
    sql: `SELECT id FROM news_sources WHERE url = ?`,
    args: [url],
  });
  if (existing.rows.length > 0) {
    return String(existing.rows[0].id);
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO news_sources (id, kind, url, name, fetch_interval_minutes, active, created_at)
          VALUES (?, 'web', ?, ?, 360, 1, ?)`,
    args: [id, url, `Discovery: ${topicName.slice(0, 80)}`, now],
  });
  return id;
}

function buildTopicQuery(t: InterestTopic): string {
  const desc = t.description ? ` (${t.description})` : "";
  return (
    `Find 5 must-read news articles published in the last 7 days about: ${t.name}${desc}. ` +
    `Prioritize primary sources, breaking news, deep technical content, real cases with names and ` +
    `numbers. AVOID generic listicles, opinion pieces without data, recycled press releases. ` +
    `Return concrete URLs of articles, not landing pages.`
  );
}

async function runOneTopic(
  topic: InterestTopic,
): Promise<{ hits: number; inserted: number; cost_cents: number; error?: string }> {
  const q = await ensureEnglish(buildTopicQuery(topic));
  try {
    const res = await perplexitySearch(q, { timeoutMs: TOPIC_TIMEOUT_MS, recencyFilter: "week" });
    const cost_cents = res.cost_cents;
    const hits = res.search_hits.length > 0 ? res.search_hits : res.citations.map((u) => ({ url: u }));
    if (hits.length === 0) return { hits: 0, inserted: 0, cost_cents };
    const sourceId = await ensureDiscoverySource(topic.name);
    let inserted = 0;
    for (const hit of hits.slice(0, MAX_HITS_PER_TOPIC)) {
      const url = "url" in hit ? hit.url : null;
      if (!url || !/^https?:\/\//.test(url)) continue;
      const title = "title" in hit && typeof hit.title === "string" ? hit.title : null;
      const snippet = "snippet" in hit && typeof hit.snippet === "string" ? hit.snippet : "";
      const publishedAt = "published_at" in hit && typeof hit.published_at === "string" ? hit.published_at : null;
      const externalId = `discovery:${url.slice(0, 200)}`;
      // Body важно положить непустым с snippet+url+тема — чтобы валидатор
      // не дисквалифицировал по пустоте. Полный текст подтянет body-enrich.
      const body =
        (snippet ? `${snippet}\n\n` : "") +
        `(найдено discovery-агентом по теме «${topic.name}»: ${url})`;
      try {
        await getDb().execute({
          sql: `INSERT INTO news_items
                  (id, source_id, external_id, url, title, body, published_at, raw_meta, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
          args: [
            randomUUID(),
            sourceId,
            externalId,
            url,
            title,
            body,
            publishedAt,
            JSON.stringify({
              discovery: true,
              topic: topic.name,
              perplexity_snippet: snippet || null,
            }),
            new Date().toISOString(),
          ],
        });
        inserted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/UNIQUE|constraint/i.test(msg)) continue;
        throw err;
      }
    }
    return { hits: hits.length, inserted, cost_cents };
  } catch (err) {
    return {
      hits: 0,
      inserted: 0,
      cost_cents: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runDiscovery(): Promise<DiscoveryRunResult> {
  const started = Date.now();
  await ensureSchema();
  const profile = await getActiveProfile();
  const active = (profile.topics ?? [])
    .filter((t) => (t.status ?? "active") === "active")
    .slice(0, MAX_TOPICS_PER_RUN);

  if (active.length === 0) {
    return {
      topics_queried: 0,
      hits_found: 0,
      items_inserted: 0,
      sources_created: 0,
      duplicates_skipped: 0,
      errors: ["no active topics in profile"],
      per_topic: [],
      cost_cents: 0,
      latency_ms: Date.now() - started,
    };
  }

  const per_topic: Array<{ topic: string; hits: number; inserted: number; error?: string }> = [];
  const errors: string[] = [];
  let hits_found = 0;
  let items_inserted = 0;
  let cost_cents = 0;

  // Гоняем темы последовательно — Perplexity rate-limit + бюджет тиков.
  for (const topic of active) {
    const r = await runOneTopic(topic);
    hits_found += r.hits;
    items_inserted += r.inserted;
    cost_cents += r.cost_cents;
    per_topic.push({ topic: topic.name, hits: r.hits, inserted: r.inserted, error: r.error });
    if (r.error) {
      errors.push(`${topic.name}: ${r.error}`);
      await logError({
        level: "warn",
        source: "server",
        route: "discovery",
        message: `discovery topic failed: ${topic.name}`,
        meta: { error: r.error },
      });
    }
  }

  return {
    topics_queried: active.length,
    hits_found,
    items_inserted,
    sources_created: 0, // источники создаются лениво, не считаем тут
    duplicates_skipped: hits_found - items_inserted,
    errors,
    per_topic,
    cost_cents,
    latency_ms: Date.now() - started,
  };
}
