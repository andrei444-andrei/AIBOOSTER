// Оркестрация одного enrichment-тика (v1.5: полная статья).
//
// 1. claimPendingEnrichment — атомарно берёт одну pending задачу.
// 2. Загружает item + профиль.
// 3. Шаг A: Определяем первоисточник.
//    - Если в теле исходного поста есть URL — первый http(s) считаем первоисточником.
//    - Если нет — формируем поисковый запрос «найди первоисточник».
// 4. Шаг B: Perplexity Sonar-pro — собираем больше источников (5-8) + summary.
// 5. Шаг C: Параллельно фетчим топ источники (≥1 первоисточник если нашли,
//    остальные из citations). Качаем full text + og:image.
// 6. Шаг D: Собираем все картинки (og:image + первые img из article-extract).
// 7. Шаг E: Opus 4.8 — полноценная статья в JSON.
// 8. completeEnrichment.

import { logServerError, logError } from "./logger";
import {
  claimPendingEnrichment,
  completeEnrichment,
  getItem,
  getActiveProfile,
  type NewsEnrichmentRow,
} from "./news";
import { perplexitySearch, sonarUrlRead } from "./perplexity-search";
import { extractArticle } from "./article-extract";
import { chatJson } from "./aimlapi";
import { ensureEnglish } from "./translate-en";
import {
  buildEnrichmentPrompt,
  validateEnrichmentOutput,
  type RelatedSource,
  type OriginalPost,
} from "./enrichment-prompt";

const SYNTHESIS_MODEL = "claude-opus-4-8";
const MAX_RELATED_SOURCES = 6;
// Бюджет: maxDuration=120s. Perplexity ~30s, fetch'и ~15s параллельно,
// Opus синтез длинного текста (1500-3000 слов) — до 70s. Остаётся ~10s
// запас.
const SYNTHESIS_TIMEOUT_MS = 70_000;
const PERPLEXITY_TIMEOUT_MS = 35_000;

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
        original_source_url: null,
        images_json: null,
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
      await logServerError(markErr, "news/enrich:mark_failed", { enrichmentId: job.id });
    }
  }
  return stats;
}

async function processOne(job: NewsEnrichmentRow): Promise<void> {
  const item = await getItem(job.item_id);
  if (!item) throw new Error(`item ${job.item_id} not found`);
  const profile = await getActiveProfile();

  const title = item.title || item.body?.slice(0, 200) || "";
  if (!title.trim()) throw new Error("empty search query");

  // ── Шаг A: первоисточник ─────────────────────────────────────────────
  // Сначала смотрим, не зашит ли URL прямо в тело поста (типично для
  // Telegram: «пишет Axios. <link>»). Если нет — попросим Perplexity сам
  // приоритезировать primary source.
  const inlineUrls = extractHttpUrls(item.body ?? "");
  let originalSourceUrl: string | null = inlineUrls.find((u) => !isAggregatorUrl(u)) ?? null;

  // ── Шаг B: Perplexity search (на ЭНГЛИЙСКОМ — там в 10× больше качественного контента) ──
  const rawQuery = buildSearchQuery(title, originalSourceUrl);
  const searchQuery = await ensureEnglish(rawQuery);
  // Recency filter: «month» — компромисс между актуальностью и охватом.
  // «week» иногда отсекает важные подтверждения, опубликованные позже исходного поста.
  const search = await perplexitySearch(searchQuery, {
    timeoutMs: PERPLEXITY_TIMEOUT_MS,
    recencyFilter: "month",
  });

  // ── Шаг C: список URL'ов для парсинга ────────────────────────────────
  // Дедуп по host (не берём 3 страницы одного сайта). Первоисточник
  // вставляем в начало, чтобы он 100% попал в выборку.
  const seenHosts = new Set<string>();
  const ordered: string[] = [];
  const push = (u: string) => {
    if (!u || !u.startsWith("http")) return;
    try {
      const h = new URL(u).hostname;
      if (seenHosts.has(h)) return;
      seenHosts.add(h);
      ordered.push(u);
    } catch {
      /* ignore */
    }
  };
  if (originalSourceUrl) push(originalSourceUrl);
  for (const u of search.citations) push(u);

  // Шаг D: parallel fetch (с soft-fail). Источник остаётся в наборе даже
  // если fetch упал — Opus имеет ответ Perplexity, может сослаться по URL.
  const fetched: RelatedSource[] = [];
  const collectedImages = new Set<string>();
  await Promise.all(
    ordered.slice(0, MAX_RELATED_SOURCES + 2).map(async (url) => {
      try {
        const art = await extractArticle(url);
        const heroImage = art.image_urls[0] ?? null;
        for (const img of art.image_urls.slice(0, 3)) {
          if (looksLikeRealImage(img)) collectedImages.add(img);
        }
        fetched.push({
          url: art.url,
          title: art.title,
          text: art.text.length >= 200 ? art.text : "",
          was_original: originalSourceUrl === url,
          hero_image: heroImage,
          published_at: art.published_at,
        });
      } catch (err) {
        await logError({
          level: "warn",
          source: "server",
          route: "news/enrich:extract",
          message: err instanceof Error ? err.message : String(err),
          meta: { url, enrichmentId: job.id },
        });
        // Не выкидываем источник: остаётся URL + пустой текст,
        // Opus возьмёт информацию из Perplexity-сниппета.
        fetched.push({
          url,
          title: null,
          text: "",
          was_original: originalSourceUrl === url,
          hero_image: null,
          published_at: null,
        });
      }
    }),
  );

  const related = fetched.slice(0, MAX_RELATED_SOURCES);
  if (originalSourceUrl && !related.some((r) => r.url === originalSourceUrl)) {
    related.unshift({
      url: originalSourceUrl,
      title: null,
      text: "",
      was_original: true,
      hero_image: null,
      published_at: null,
    });
  }

  // ── Шаг D+: Sonar URL-read fallback для источников с пустым текстом ──
  // У Perplexity свой crawler с data-deals — часто видит paywall/JS-SPA.
  // Запускаем параллельно, мягко падаем на ошибки.
  let extraSonarCost = 0;
  await Promise.all(
    related.map(async (r, idx) => {
      if (r.text && r.text.length >= 200) return;
      try {
        const read = await sonarUrlRead(r.url, { timeoutMs: 18_000 });
        if (read.text && read.text.length >= 200) {
          related[idx] = {
            ...r,
            text: read.text,
            title: r.title || read.title,
            published_at: r.published_at || read.published_at,
          };
          extraSonarCost += read.cost_cents;
          console.log(`[news/enrich] sonar-url-read OK for ${r.url} (${read.text.length} chars)`);
        }
      } catch (err) {
        await logError({
          level: "warn",
          source: "server",
          route: "news/enrich:sonar_url_read",
          message: err instanceof Error ? err.message : String(err),
          meta: { url: r.url, enrichmentId: job.id },
        });
      }
    }),
  );

  // ── Шаг E: Opus full-article синтез ──────────────────────────────────
  const originalPost: OriginalPost = {
    title: item.title,
    body: item.body ?? "",
    url: item.url,
    source_name: item.source_name,
    matched_topics: parseTopics(item.matched_topics_json),
    published_at: item.published_at,
  };
  const imageList = [...collectedImages];
  const prompt = buildEnrichmentPrompt(profile, originalPost, search.answer, related, imageList);
  const inputDump = `SYSTEM:\n${prompt.system}\n\n---\nUSER:\n${prompt.user}`;

  const syn = await chatJson<unknown>({
    model: SYNTHESIS_MODEL,
    system: prompt.system,
    user: prompt.user,
    temperature: 0.3,
    timeoutMs: SYNTHESIS_TIMEOUT_MS,
    requestId: job.id,
  });

  const parsed = validateEnrichmentOutput(syn.parsed);
  const baseDump = {
    search_results_json: JSON.stringify({ answer: search.answer, citations: search.citations }),
    related_sources_json: JSON.stringify(related.map((r) => ({ url: r.url, title: r.title, was_original: r.was_original }))),
    original_source_url: originalSourceUrl,
    synthesis_input: inputDump,
    synthesis_output_json: syn.rawText.slice(0, 32_000),
    model_used: syn.model,
    cost_cents: search.cost_cents + extraSonarCost + estimateOpusCostCents(syn.rawText),
    latency_ms: syn.latencyMs,
  };

  if (!parsed) {
    await completeEnrichment(job.id, {
      ...baseDump,
      status: "failed",
      synthesis_error: "opus returned non-conforming JSON or article_body too short",
      synthesized_summary: null,
      key_facts: null,
      sources_used: null,
      images_json: null,
    });
    return;
  }

  // Финальный набор картинок: то, что Opus отобрал, + если ничего не вернул —
  // первые 2 hero_image из источников. Это спасает случаи, когда Opus
  // забыл секцию images.
  let finalImages = parsed.images;
  if (finalImages.length === 0) {
    finalImages = related
      .map((r) => (r.hero_image ? { url: r.hero_image, caption: "", source_url: r.url } : null))
      .filter((x): x is { url: string; caption: string; source_url: string } => x !== null)
      .slice(0, 2);
  }

  await completeEnrichment(job.id, {
    ...baseDump,
    status: "done",
    synthesis_error: null,
    synthesized_summary: parsed.article_body,
    key_facts: parsed.key_facts,
    sources_used: parsed.sources_used,
    images_json: JSON.stringify(finalImages),
  });
}

function buildSearchQuery(title: string, originalUrl: string | null): string {
  const base = title.trim();
  if (originalUrl) {
    return (
      `Find more sources, confirmations, и контекст для этой новости. ` +
      `Найди первоисточник (приоритет — primary outlets вроде Axios/Bloomberg/Reuters/WSJ/AP), ` +
      `подтверждения от других СМИ, и официальные заявления вовлечённых компаний. ` +
      `Если ${originalUrl} — действительно первоисточник, подтверди. ` +
      `Тема: ${base}`
    );
  }
  return (
    `Find the original primary source (Axios / Bloomberg / Reuters / WSJ / AP / company press release ` +
    `или другое первоисточное издание) для этой новости, а также confirming sources и context. ` +
    `Верни URL'ы всех найденных материалов. Тема: ${base}`
  );
}

const HTTP_URL_RE = /https?:\/\/[^\s)<>"'«»]+/g;
function extractHttpUrls(text: string): string[] {
  const found = (text || "").match(HTTP_URL_RE) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,;:!?)\]]+$/, "")))].filter((u) => u.length < 500);
}

// Агрегаторы / соцсети / шортнеры — НЕ первоисточник.
const AGGREGATOR_HOSTS = new Set([
  "t.me",
  "telegram.me",
  "twitter.com",
  "x.com",
  "vk.com",
  "facebook.com",
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "linkedin.com",
  "reddit.com",
  "news.ycombinator.com",
  "bit.ly",
  "tinyurl.com",
  "lnkd.in",
  "buff.ly",
  "ift.tt",
]);
function isAggregatorUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname.replace(/^www\./, "");
    return AGGREGATOR_HOSTS.has(h);
  } catch {
    return true;
  }
}

// Грубо отсеиваем логотипы, иконки, аватарки, base64. Хорошие новостные
// картинки — крупные, обычно содержат «1200», «1080», «1024», «800»,
// «hero» или схожие в URL. Иначе фильтруем по расширению.
function looksLikeRealImage(url: string): boolean {
  if (!url.startsWith("http")) return false;
  if (/\.(svg|gif|ico)(\?|$)/i.test(url)) return false;
  if (/logo|favicon|avatar|emoji|sprite|placeholder|tracking|pixel/i.test(url)) return false;
  // Если в URL есть указание ширины — пропускаем мелкие.
  const m = url.match(/[?&_-](\d{3,4})x(\d{3,4})/) ?? url.match(/(\d{3,4})[wx](\d{3,4})/);
  if (m) {
    const w = parseInt(m[1], 10);
    if (Number.isFinite(w) && w < 300) return false;
  }
  return /\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(url) || /\/image|\/img\/|\/photo|\/cdn-cgi\/image/i.test(url);
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

function estimateOpusCostCents(rawText: string): number {
  const outputTokens = Math.ceil(rawText.length / 4);
  return Math.ceil(outputTokens * 0.000075 * 100);
}
