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
import { fetchArticleViaApify } from "./apify-article";
import { analyzeImageBatch } from "./vision-analyze";
import {
  buildEnrichmentPrompt,
  validateEnrichmentOutput,
  type RelatedSource,
  type OriginalPost,
} from "./enrichment-prompt";

const SYNTHESIS_MODEL = "claude-opus-4-8";
// Сократили с 6 до 4 — Vercel 120s budget неравномерно тратился на
// fetch+Sonar+Apify, не хватало на Opus. С 4 источниками pipeline
// стабильно укладывается в ~80-110s.
const MAX_RELATED_SOURCES = 4;
const SYNTHESIS_TIMEOUT_MS = 60_000;
const PERPLEXITY_TIMEOUT_MS = 25_000;

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
  const started = Date.now();
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
  // Только для топ-N важных (первоисточник + первые 2). Иначе на 6
  // параллельных вызовах добавим лишних 15-30 с latency и можем упереться
  // в Vercel 120s бюджет.
  let extraSonarCost = 0;
  const SONAR_FALLBACK_BUDGET = 2;
  // Сортируем: was_original → начало; остальные сохраняют исходный порядок.
  const fallbackTargets = related
    .map((r, idx) => ({ r, idx }))
    .filter(({ r }) => !r.text || r.text.length < 200)
    .sort((a, b) => Number(b.r.was_original ?? false) - Number(a.r.was_original ?? false))
    .slice(0, SONAR_FALLBACK_BUDGET);

  await Promise.all(
    fallbackTargets.map(async ({ r, idx }) => {
      try {
        const read = await sonarUrlRead(r.url, { timeoutMs: 12_000 });
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

  // ── Шаг D++: Apify article-extractor для ЛЮБЫХ источников, у которых
  //    после HTML+Sonar всё ещё пустой text. Это уровень «героя»: Apify
  //    рендерит JS, обходит большинство paywall/Cloudflare-блоков. Кап на
  //    2 вызова — Apify дорогой (~$0.05-0.10 за run), и в большинстве
  //    случаев 1-2 хороших источника достаточно для Opus.
  let extraApifyCost = 0;
  // 1 Apify-вызов на enrichment максимум — он медленный (15-30s) и дорогой
  // (~10¢). Если первый успешен — этого хватает Opus'у в дополнение к
  // другим источникам.
  const APIFY_BUDGET = 1;
  if (!process.env.APIFY_TOKEN) {
    console.log(`[news/enrich] APIFY_TOKEN not set — skipping Apify fallback`);
  } else {
    // Сортируем приоритет: was_original вперёд, затем обычные.
    const apifyTargets = related
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => !r.text || r.text.length < 200)
      .sort((a, b) => Number(b.r.was_original ?? false) - Number(a.r.was_original ?? false))
      .slice(0, APIFY_BUDGET);

    for (const { r, idx } of apifyTargets) {
      try {
        const apify = await fetchArticleViaApify(r.url, { timeoutMs: 30_000 });
        if (apify.text && apify.text.length >= 200) {
          related[idx] = {
            ...r,
            text: apify.text,
            title: r.title || apify.title,
            published_at: r.published_at || apify.published_at,
          };
          extraApifyCost += apify.cost_cents;
          console.log(`[news/enrich] apify OK for ${r.url} (${apify.text.length} chars, ${apify.cost_cents}¢)`);
        } else {
          console.log(`[news/enrich] apify empty for ${r.url}`);
        }
      } catch (err) {
        await logError({
          level: "warn",
          source: "server",
          route: "news/enrich:apify_article",
          message: err instanceof Error ? err.message : String(err),
          meta: { url: r.url, enrichmentId: job.id },
        });
      }
    }
  }

  // ── Шаг E: Opus full-article синтез ──────────────────────────────────
  const originalPost: OriginalPost = {
    title: item.title,
    body: item.body ?? "",
    url: item.url,
    source_name: item.source_name,
    matched_topics: parseTopics(item.matched_topics_json),
    published_at: item.published_at,
    is_vendor_case_study: isVendorCaseStudyUrl(item.url),
  };
  // ── Шаг D+++: Vision-анализ собранных картинок ──────────────────────
  // Каждую картинку прогоняем через Sonnet 4.6 vision и спрашиваем:
  // что это, релевантно ли, какие данные/цифры. Отсеиваем мусор
  // (логотипы, ads, декорации), оставляем релевантные с подписями.
  const imageContext = `${item.title ?? ""} | ${(item.body ?? "").slice(0, 300)}`;
  const visionResult = await analyzeImageBatch([...collectedImages], imageContext, {
    maxToAnalyze: 8,
  });
  const extraVisionCost = visionResult.cost_cents;
  // В Opus идут только реально полезные картинки с уже сгенерированными
  // подписями, meaning, и data_extracted для чартов/скриншотов.
  const annotatedImages = visionResult.analyses
    .filter((a) => a.is_relevant && a.category !== "logo" && a.category !== "ad" && a.category !== "decoration")
    .slice(0, 8);
  const annotatedImageBlock = annotatedImages
    .map((a, i) => {
      const data = a.data_extracted ? `\n   ВЫЖИМКА ДАННЫХ: ${a.data_extracted}` : "";
      const meaning = a.meaning ? `\n   СМЫСЛ: ${a.meaning}` : "";
      return `${i + 1}. URL: ${a.url}\n   ТИП: ${a.category}\n   ПОДПИСЬ: ${a.caption}${meaning}${data}`;
    })
    .join("\n");
  console.log(`[news/enrich] vision: ${visionResult.analyses.length} analyzed, ${annotatedImages.length} kept`);

  // ── Шаг E−: Pre-synthesis sufficiency check ─────────────────────────
  // Если материала почти нет (вендорский кейс одной строкой + Perplexity
  // вернул «couldn't verify»), Opus синтезирует «честный разбор того,
  // что у нас нет источников» — мета-статью без пользы. Лучше написать
  // короткий шаблон, не вызывая Opus и не тратя $0.3.
  const substantiveSources = related.filter((r) => (r.text || "").length >= 200);
  const isInsufficient =
    substantiveSources.length === 0 &&
    (item.body || "").length < 1500 &&
    (search.answer || "").length < 1000;

  if (isInsufficient) {
    console.log(
      `[news/enrich] insufficient material (sources=${substantiveSources.length}, body=${(item.body || "").length}ch, perplexity=${(search.answer || "").length}ch) — пишу шаблон, Opus не зову`,
    );
    const minimal = buildMinimalEnrichment(item, originalSourceUrl ?? item.url);
    await completeEnrichment(job.id, {
      status: "done",
      search_results_json: JSON.stringify({ answer: search.answer, citations: search.citations }),
      related_sources_json: JSON.stringify(related.map((r) => ({ url: r.url, title: r.title, was_original: r.was_original }))),
      original_source_url: originalSourceUrl,
      images_json: JSON.stringify(annotatedImages.slice(0, 1).map((a) => ({ url: a.url, caption: a.caption, meaning: a.meaning, source_url: "" }))),
      synthesis_input: null,
      synthesis_output_json: JSON.stringify(minimal.outputJson),
      synthesis_error: null,
      model_used: "skip-synthesis",
      synthesized_summary: minimal.article_body,
      key_facts: minimal.key_facts,
      sources_used: minimal.sources_used,
      cost_cents: search.cost_cents + extraSonarCost + extraApifyCost + extraVisionCost,
      latency_ms: Date.now() - started,
    });
    return;
  }

  const prompt = buildEnrichmentPrompt(
    profile,
    originalPost,
    search.answer,
    related,
    annotatedImages.map((a) => a.url),
    annotatedImageBlock,
  );
  const inputDump = `SYSTEM:\n${prompt.system}\n\n---\nUSER:\n${prompt.user}`;

  const syn = await chatJson<unknown>({
    model: SYNTHESIS_MODEL,
    system: prompt.system,
    user: prompt.user,
    temperature: 0.3,
    timeoutMs: SYNTHESIS_TIMEOUT_MS,
    requestId: job.id,
    // Статьи 1500-2500 слов на русском (~15-25К символов) плюс остальные поля
    // JSON. 32К токенов — запас для длинной аналитики (Verdad, HBR), чтобы
    // Opus не урезал концовку при глубоком разборе.
    maxTokens: 32_000,
  });

  const parsed = validateEnrichmentOutput(syn.parsed);
  const baseDump = {
    search_results_json: JSON.stringify({ answer: search.answer, citations: search.citations }),
    related_sources_json: JSON.stringify(related.map((r) => ({ url: r.url, title: r.title, was_original: r.was_original }))),
    original_source_url: originalSourceUrl,
    synthesis_input: inputDump,
    synthesis_output_json: syn.rawText.slice(0, 200_000),
    model_used: syn.model,
    cost_cents:
      search.cost_cents +
      extraSonarCost +
      extraApifyCost +
      extraVisionCost +
      estimateOpusCostCents(syn.rawText),
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
  // первые 2 vision-annotated картинки. Это спасает случаи, когда Opus
  // забыл секцию images.
  let finalImages = parsed.images;
  if (finalImages.length === 0) {
    finalImages = annotatedImages.slice(0, 6).map((a) => ({
      url: a.url,
      caption: a.caption,
      meaning: a.meaning,
      source_url: "",
    }));
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

// Вендорские маркетинговые кейсы / success-stories. Контент по умолчанию
// одно-источниковый и предвзятый — отбираемая клиентом победа.
const VENDOR_CASE_STUDY_RE = /\/(customers?|case[-_]?stud(y|ies)|success[-_]?stor(y|ies)|customer[-_]?stor(y|ies))\//i;
export function isVendorCaseStudyUrl(u: string | null | undefined): boolean {
  if (!u || typeof u !== "string") return false;
  try {
    const url = new URL(u);
    return VENDOR_CASE_STUDY_RE.test(url.pathname);
  } catch {
    return false;
  }
}

// Шаблонная карточка, когда материала почти нет и Opus звать не за что.
// Вместо «честного разбора» в 6К знаков — 100-200 слов фактов + явная
// quality_note. Цена: $0 (нет LLM-вызова).
function buildMinimalEnrichment(
  item: { title: string | null; body: string | null; url: string | null; source_name?: string | null },
  fallbackUrl: string | null,
): {
  article_body: string;
  key_facts: string[];
  sources_used: Array<{ url: string; title: string; role: "original" | "confirmation" | "context"; why_relevant: string }>;
  outputJson: Record<string, unknown>;
} {
  const url = item.url || fallbackUrl || "";
  const source = item.source_name || (url ? new URL(url).hostname.replace(/^www\./, "") : "источник");
  const title = (item.title || "").trim() || "(без заголовка)";
  const bodyExcerpt = (item.body || "").trim().slice(0, 600);
  const isVendor = isVendorCaseStudyUrl(url);
  const lead = isVendor
    ? `Маркетинговый кейс на сайте ${source}. Цифры и формулировки приведены самим вендором; независимых подтверждений в моём сборе нет.`
    : `Сборка не нашла независимых источников по этому материалу. Ниже — то, что есть в оригинальной публикации.`;
  const body = [
    `## ${title}`,
    "",
    lead,
    "",
    bodyExcerpt || "Тело оригинала пустое или короткое — открой первоисточник по ссылке ниже.",
    "",
    url ? `**Оригинал:** [${source}](${url})` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const key_facts: string[] = [];
  if (item.title) key_facts.push(`Заголовок оригинала: «${item.title.trim().slice(0, 200)}»`);
  if (isVendor) key_facts.push("Источник — раздел customers/case-studies сайта вендора, контент маркетинговый.");
  key_facts.push("Дополнительных источников нет — глубокий разбор невозможен.");

  const sources_used: Array<{
    url: string;
    title: string;
    role: "original" | "confirmation" | "context";
    why_relevant: string;
  }> = url
    ? [{ url, title: title.slice(0, 200), role: "original", why_relevant: "единственный источник" }]
    : [];

  const outputJson = {
    headline: title.slice(0, 120),
    lead: isVendor
      ? `Вендорский кейс ${source}.`
      : `Краткая выжимка из оригинала ${source}.`,
    article_body: body,
    concrete_examples: [],
    key_facts,
    quotes: [],
    timeline: [],
    contradictions: [],
    implications: "",
    images: [],
    sources_used,
    quality_note: isVendor
      ? "Источник — маркетинговый кейс вендора. Цифры от него самого. Глубокий разбор не делал."
      : "Источников недостаточно для разбора. Показал только заголовок + ссылку на оригинал.",
  };

  return { article_body: body, key_facts, sources_used, outputJson };
}
