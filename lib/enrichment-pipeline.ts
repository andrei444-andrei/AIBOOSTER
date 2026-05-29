// Оркестрация одного enrichment-тика.
//
// 1. claimPendingEnrichment — атомарно берёт одну pending задачу под лок.
// 2. Загружает исходный item + профиль.
// 3. Perplexity Sonar: ищет по title исходного поста, получает answer + citations.
// 4. Фетчит до N citations через article-extract.
// 5. Opus-синтез по originalPost + Perplexity-answer + extracted articles.
// 6. completeEnrichment с status='done' (или 'failed', если что-то упало).
//
// За один tick — одно обогащение (Sonar ~5-10s + 3-5 fetch'ей ~2-3s каждый
// + Opus 15-30s = ~30-50s, помещается в maxDuration=60).

import { logServerError, logError } from "./logger";
import {
  claimPendingEnrichment,
  completeEnrichment,
  getItem,
  getActiveProfile,
  type NewsEnrichmentRow,
} from "./news";
import { perplexitySearch } from "./perplexity-search";
import { extractArticle } from "./article-extract";
import { chatJson } from "./aimlapi";
import {
  buildEnrichmentPrompt,
  validateEnrichmentOutput,
  type RelatedSource,
  type OriginalPost,
} from "./enrichment-prompt";

const SYNTHESIS_MODEL = "claude-opus-4-8";
const MAX_RELATED_SOURCES = 4;
const SYNTHESIS_TIMEOUT_MS = 45_000;

export interface EnrichTickStats {
  processed: number;
  succeeded: number;
  failed: number;
  warnings: string[];
}

export async function runEnrichTick(): Promise<EnrichTickStats> {
  const stats: EnrichTickStats = { processed: 0, succeeded: 0, failed: 0, warnings: [] };

  if (!process.env.AIMLAPI_KEY) {
    stats.warnings.push("AIMLAPI_KEY not set — enrich skipped");
    return stats;
  }

  const job = await claimPendingEnrichment();
  if (!job) return stats;

  stats.processed = 1;
  const started = Date.now();
  try {
    await processOne(job);
    stats.succeeded = 1;
    console.log(`[news/enrich] done id=${job.id} took=${Date.now() - started}ms`);
  } catch (err) {
    stats.failed = 1;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[news/enrich] failed id=${job.id} err=${msg.slice(0, 200)}`);
    await logServerError(err, "news/enrich:process", { enrichmentId: job.id, itemId: job.item_id });
    try {
      await completeEnrichment(job.id, {
        status: "failed",
        search_results_json: null,
        related_sources_json: null,
        synthesis_input: null,
        synthesis_output_json: null,
        synthesis_error: msg.slice(0, 4000),
        model_used: SYNTHESIS_MODEL,
        synthesized_summary: null,
        key_facts: null,
        sources_used: null,
        cost_cents: null,
        latency_ms: Date.now() - started,
      });
    } catch (markErr) {
      // Не дали пометить failed — этим займётся 5-минутный stale-lock retry.
      await logServerError(markErr, "news/enrich:mark_failed", { enrichmentId: job.id });
    }
  }
  return stats;
}

async function processOne(job: NewsEnrichmentRow): Promise<void> {
  const item = await getItem(job.item_id);
  if (!item) throw new Error(`item ${job.item_id} not found`);
  const profile = await getActiveProfile();

  // 1. Web-поиск через Perplexity.
  const query = job.search_query || item.title || item.body?.slice(0, 200) || "";
  if (!query.trim()) throw new Error("empty search query");
  const search = await perplexitySearch(query, { timeoutMs: 25_000 });

  // 2. Качаем до N citations. Дедуп по host (чтобы не брать 3 страницы
  //    одного сайта), не блокируемся на падающих.
  const seenHosts = new Set<string>();
  const candidates = search.citations.filter((u) => {
    try {
      const h = new URL(u).hostname;
      if (seenHosts.has(h)) return false;
      seenHosts.add(h);
      return true;
    } catch {
      return false;
    }
  });

  const related: RelatedSource[] = [];
  for (const url of candidates) {
    if (related.length >= MAX_RELATED_SOURCES) break;
    try {
      const art = await extractArticle(url);
      if (art.text && art.text.length > 200) {
        related.push({ url: art.url, title: art.title, text: art.text });
      }
    } catch (err) {
      // Soft-fail: один paywall не должен валить весь enrichment.
      await logError({
        level: "warn",
        source: "server",
        route: "news/enrich:extract",
        message: err instanceof Error ? err.message : String(err),
        meta: { url, enrichmentId: job.id },
      });
    }
  }

  // 3. Opus-синтез.
  const originalPost: OriginalPost = {
    title: item.title,
    body: item.body ?? "",
    url: item.url,
    source_name: item.source_name,
    matched_topics: parseTopics(item.matched_topics_json),
  };
  const prompt = buildEnrichmentPrompt(profile, originalPost, search.answer, related);
  const inputDump = `SYSTEM:\n${prompt.system}\n\n---\nUSER:\n${prompt.user}`;

  const syn = await chatJson<unknown>({
    model: SYNTHESIS_MODEL,
    system: prompt.system,
    user: prompt.user,
    temperature: 0.2,
    timeoutMs: SYNTHESIS_TIMEOUT_MS,
    requestId: job.id,
  });

  const parsed = validateEnrichmentOutput(syn.parsed);
  if (!parsed) {
    await completeEnrichment(job.id, {
      status: "failed",
      search_results_json: JSON.stringify({ answer: search.answer, citations: search.citations }),
      related_sources_json: JSON.stringify(related.map((r) => ({ url: r.url, title: r.title }))),
      synthesis_input: inputDump,
      synthesis_output_json: syn.rawText.slice(0, 16_000),
      synthesis_error: "opus returned non-conforming JSON",
      model_used: syn.model,
      synthesized_summary: null,
      key_facts: null,
      sources_used: null,
      cost_cents: search.cost_cents + estimateOpusCostCents(syn.rawText),
      latency_ms: syn.latencyMs,
    });
    return;
  }

  await completeEnrichment(job.id, {
    status: "done",
    search_results_json: JSON.stringify({ answer: search.answer, citations: search.citations }),
    related_sources_json: JSON.stringify(related.map((r) => ({ url: r.url, title: r.title }))),
    synthesis_input: inputDump,
    synthesis_output_json: syn.rawText.slice(0, 16_000),
    synthesis_error: null,
    model_used: syn.model,
    synthesized_summary: parsed.summary,
    key_facts: parsed.key_facts,
    sources_used: parsed.sources_used,
    cost_cents: search.cost_cents + estimateOpusCostCents(syn.rawText),
    latency_ms: syn.latencyMs,
  });
}

function parseTopics(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Грубая оценка стоимости Opus 4.8: ~$15/M input + $75/M output.
// Считаем по длине rawText как proxy для output tokens; input неточный,
// поэтому это just-for-monitoring, не биллинг.
function estimateOpusCostCents(rawText: string): number {
  const outputTokens = Math.ceil(rawText.length / 4); // ~4 char/token grubo
  return Math.ceil((outputTokens * 0.000075) * 100);
}
