// Оркестрация одного cron-tick для новостной ленты.
//
// Шаги (все мягко-fail: ошибка по одному источнику/посту не валит весь tick):
//   1. Засеять дефолты (если БД пуста).
//   2. Взять claimDueSource — атомарный лок на один источник.
//   3. Если telegram + есть активный apify_run_id → подтянуть статус;
//      если RUNNING → отпустить лок (next tick подберёт);
//      если SUCCEEDED → забрать dataset, вставить items, пометить fetched.
//      Если telegram без активного run → запустить новый run (return).
//   4. Если rss → fetch + parse + insert items, пометить fetched.
//   5. Отдельная фаза: подобрать N pending-items, прогнать через валидатор.
//
// Cron вызывается раз в 10 мин. За один tick обрабатываем 1 источник (на
// первом визите канала запускаем Apify, на втором — забираем) и до
// VALIDATE_BATCH постов. Так держим время функции в пределах 60s.

import { logServerError, logError } from "./logger";
import {
  claimDueSource,
  releaseSource,
  setSourceFetched,
  insertRawItem,
  getPendingItems,
  applyValidation,
  getActiveProfile,
  seedProfileIfEmpty,
  seedSourcesIfEmpty,
  seedExtraSourcesIfMissing,
  enqueueEnrichment,
  type NewsSourceRow,
  type NewsItemRow,
} from "./news";
import { fetchTelegramChannel } from "./telegram-scrape";
import { fetchRss, stripHtml } from "./rss";
import { fetchWebHeadlines } from "./web-scrape";
import { extractArticle } from "./article-extract";
import { sonarUrlRead } from "./perplexity-search";
import { fetchArticleViaApify } from "./apify-article";
import { chatJson } from "./aimlapi";
import {
  buildValidatorPrompt,
  validateValidatorOutput,
  type ValidatorOutput,
  type InterestProfile,
  type PostForValidation,
} from "./news-prompt";

const VALIDATOR_MODEL = "claude-sonnet-4-6";
// Размер батча валидации намеренно небольшой: каждая валидация теперь
// включает body-enrich фазу (~10-15 сек на article-extract + Sonar URL-read),
// плюс сам Sonnet-call (~5-8 сек). За один tick укладываемся в ~50 сек,
// 2 валидации × 25 сек = 50 сек. Остальные pending подберёт следующий тик.
const VALIDATE_BATCH = 2;
const MAX_ITEMS_PER_SOURCE = 20;
const VALIDATION_TIME_BUDGET_MS = 50_000;
const CHAT_TIMEOUT_MS = 25_000;

export interface TickStats {
  seeded_profile: boolean;
  seeded_sources: number;
  source_processed: string | null;
  source_action: string | null;
  items_inserted: number;
  validated: number;
  validated_show: number;
  validated_skip: number;
  validation_failed: number;
  warnings: string[];
  errors: string[];
}

export async function runTick(workerId: string): Promise<TickStats> {
  const tickStarted = Date.now();
  const stats: TickStats = {
    seeded_profile: false,
    seeded_sources: 0,
    source_processed: null,
    source_action: null,
    items_inserted: 0,
    validated: 0,
    validated_show: 0,
    validated_skip: 0,
    validation_failed: 0,
    warnings: [],
    errors: [],
  };

  console.log(`[news/tick] start worker=${workerId}`);

  // Сидим дефолты — после ensureSchema (вызывается внутри news.ts функций).
  try {
    stats.seeded_profile = await seedProfileIfEmpty();
    console.log(`[news/tick] seed_profile=${stats.seeded_profile} t=${Date.now() - tickStarted}ms`);
  } catch (err) {
    await logServerError(err, "news/cron/tick:seed_profile");
    stats.errors.push(`seed_profile: ${errMsg(err)}`);
  }
  try {
    stats.seeded_sources = await seedSourcesIfEmpty();
    console.log(`[news/tick] seed_sources=${stats.seeded_sources} t=${Date.now() - tickStarted}ms`);
  } catch (err) {
    await logServerError(err, "news/cron/tick:seed_sources");
    stats.errors.push(`seed_sources: ${errMsg(err)}`);
  }
  // Extra-seed: Reddit/arXiv добавляем всегда, если URL ещё нет. Идемпотентно.
  try {
    const extra = await seedExtraSourcesIfMissing();
    if (extra > 0) {
      stats.seeded_sources += extra;
      console.log(`[news/tick] seed_extra=${extra} t=${Date.now() - tickStarted}ms`);
    }
  } catch (err) {
    await logServerError(err, "news/cron/tick:seed_extra");
    stats.errors.push(`seed_extra: ${errMsg(err)}`);
  }

  // Фаза 1: фетч одного due-источника.
  let source: NewsSourceRow | null = null;
  try {
    source = await claimDueSource(workerId);
    console.log(`[news/tick] claim_source=${source?.name ?? "none"} t=${Date.now() - tickStarted}ms`);
  } catch (err) {
    await logServerError(err, "news/cron/tick:claim_source");
    stats.errors.push(`claim_source: ${errMsg(err)}`);
  }

  if (source) {
    stats.source_processed = source.name;
    try {
      if (source.kind === "telegram") {
        const acted = await processTelegramSource(source, stats);
        stats.source_action = acted;
      } else if (source.kind === "rss") {
        const acted = await processRssSource(source, stats);
        stats.source_action = acted;
      } else if (source.kind === "web") {
        const acted = await processWebSource(source, stats);
        stats.source_action = acted;
      } else {
        stats.warnings.push(`unknown source kind: ${source.kind}`);
        await releaseSource(source.id);
      }
      console.log(`[news/tick] process_source action=${stats.source_action} inserted=${stats.items_inserted} t=${Date.now() - tickStarted}ms`);
    } catch (err) {
      await logServerError(err, "news/cron/tick:process_source", {
        source_id: source.id,
        source_name: source.name,
        kind: source.kind,
      });
      stats.errors.push(`process_source ${source.name}: ${errMsg(err)}`);
      // Помечаем last_fetched_at чтобы не дёргать упавший источник каждый
      // тик: следующая попытка через fetch_interval_minutes (по дефолту 30 мин).
      // Без этого один поломанный источник (Apify 404 / RSS gone) забивает
      // app_errors каждые 10 минут.
      await setSourceFetched(source.id).catch(() => {});
    }
  }

  // Фаза 2: валидация pending-items. Только если есть time-budget.
  const elapsed = Date.now() - tickStarted;
  if (elapsed >= VALIDATION_TIME_BUDGET_MS) {
    stats.warnings.push(`skip validation phase, elapsed=${elapsed}ms`);
    console.log(`[news/tick] skip_validation elapsed=${elapsed}ms`);
    return stats;
  }

  let pending: NewsItemRow[] = [];
  try {
    pending = await getPendingItems(VALIDATE_BATCH);
    console.log(`[news/tick] pending=${pending.length} t=${Date.now() - tickStarted}ms`);
  } catch (err) {
    await logServerError(err, "news/cron/tick:get_pending");
    stats.errors.push(`get_pending: ${errMsg(err)}`);
  }

  if (pending.length > 0) {
    let profile: InterestProfile;
    try {
      profile = await getActiveProfile();
    } catch (err) {
      await logServerError(err, "news/cron/tick:get_profile");
      stats.errors.push(`get_profile: ${errMsg(err)}`);
      return stats;
    }

    if (!process.env.AIMLAPI_KEY) {
      stats.warnings.push("AIMLAPI_KEY not set — validation skipped");
      console.log(`[news/tick] no AIMLAPI_KEY`);
      return stats;
    }

    for (const item of pending) {
      // Не запускаем новую валидацию если не хватит времени её закончить.
      const remaining = VALIDATION_TIME_BUDGET_MS - (Date.now() - tickStarted);
      if (remaining < CHAT_TIMEOUT_MS) {
        stats.warnings.push(`skip remaining validations, time_left=${remaining}ms`);
        console.log(`[news/tick] partial_validation done=${stats.validated} time_left=${remaining}ms`);
        break;
      }
      const itemStarted = Date.now();
      try {
        const result = await validateOne(item, profile);
        if (result === "failed") {
          stats.validation_failed++;
        } else {
          stats.validated++;
          if (result === "show") stats.validated_show++;
          else if (result === "skip") stats.validated_skip++;
        }
        console.log(`[news/tick] validated ${item.id} result=${result} dt=${Date.now() - itemStarted}ms`);
      } catch (err) {
        stats.validation_failed++;
        console.log(`[news/tick] validation_failed ${item.id} dt=${Date.now() - itemStarted}ms err=${errMsg(err).slice(0, 200)}`);
        await logServerError(err, "news/cron/tick:validate_item", {
          item_id: item.id,
          source_id: item.source_id,
        });
      }
    }
  }

  console.log(`[news/tick] done total=${Date.now() - tickStarted}ms stats=${JSON.stringify({
    inserted: stats.items_inserted,
    validated: stats.validated,
    show: stats.validated_show,
    skip: stats.validated_skip,
    failed: stats.validation_failed,
  })}`);
  return stats;
}

// Telegram-источник теперь читается напрямую через t.me/s/CHANNEL
// (публичный web-preview, не требует Apify/MTProto/токена). За один tick:
// fetch → parse → insert. Это покрывает 95% MVP-кейса (публичные новостные
// каналы). Для приватных/чатов потребовался бы MTProto — пока вне scope.
// Парсит один source синхронно — без cron'a, без claim'а. Используется
// ручной кнопкой «Запустить сейчас» на /news/sources. Сразу обновляет
// last_fetched_at, чтобы следующий cron не дёрнул его повторно.
export async function processSourceNow(
  source: NewsSourceRow,
): Promise<{ action: string; inserted: number; warnings: string[] }> {
  const stats: TickStats = {
    seeded_profile: false,
    seeded_sources: 0,
    source_processed: source.name,
    source_action: null,
    items_inserted: 0,
    validated: 0,
    validated_show: 0,
    validated_skip: 0,
    validation_failed: 0,
    warnings: [],
    errors: [],
  };
  let action: string;
  if (source.kind === "telegram") {
    action = await processTelegramSource(source, stats);
  } else if (source.kind === "rss") {
    action = await processRssSource(source, stats);
  } else if (source.kind === "web") {
    action = await processWebSource(source, stats);
  } else {
    throw new Error(`unknown source kind: ${source.kind}`);
  }
  return { action, inserted: stats.items_inserted, warnings: stats.warnings };
}

async function processTelegramSource(
  source: NewsSourceRow,
  stats: TickStats,
): Promise<string> {
  const posts = await fetchTelegramChannel(source.url);
  const limited = posts.slice(0, MAX_ITEMS_PER_SOURCE);
  let inserted = 0;
  for (const p of limited) {
    const id = await insertRawItem({
      source_id: source.id,
      external_id: p.external_id,
      url: p.url || null,
      title: p.title,
      body: p.body,
      published_at: p.published_at,
      raw_meta: p.raw_meta,
    });
    if (id) inserted++;
  }
  stats.items_inserted += inserted;
  await setSourceFetched(source.id);
  return `tg_${inserted}_of_${posts.length}`;
}

async function processWebSource(
  source: NewsSourceRow,
  stats: TickStats,
): Promise<string> {
  const items = await fetchWebHeadlines(source.url);
  const limited = items.slice(0, MAX_ITEMS_PER_SOURCE);
  let inserted = 0;
  for (const it of limited) {
    const id = await insertRawItem({
      source_id: source.id,
      external_id: it.external_id,
      url: it.url || null,
      title: it.title,
      body: it.body,
      published_at: it.published_at,
      raw_meta: it.raw_meta,
    });
    if (id) inserted++;
  }
  stats.items_inserted += inserted;
  await setSourceFetched(source.id);
  return `web_${inserted}_of_${items.length}`;
}

async function processRssSource(
  source: NewsSourceRow,
  stats: TickStats,
): Promise<string> {
  const items = await fetchRss(source.url, MAX_ITEMS_PER_SOURCE);
  let inserted = 0;
  for (const it of items) {
    const id = await insertRawItem({
      source_id: source.id,
      external_id: it.external_id,
      url: it.url || null,
      title: it.title,
      body: stripHtml(it.body || ""),
      published_at: it.published_at,
      raw_meta: it.raw_meta,
    });
    if (id) inserted++;
  }
  stats.items_inserted += inserted;
  await setSourceFetched(source.id);
  return `rss_${inserted}_of_${items.length}`;
}

async function validateOne(
  item: NewsItemRow,
  profile: InterestProfile,
): Promise<"show" | "borderline" | "skip" | "failed"> {
  // BODY-ENRICH перед валидацией: для RSS-aggregator'ов (HN, HBR), web-скрейпа
  // главной (bloomberg.com) и многих rss-only ленты — приходит только title.
  // Без полного текста Sonnet штрафует за «поверхностно», и почти всё уходит
  // в skip. Если body < 800 chars и есть URL — пробуем дотянуть полный текст:
  // сначала наш HTML-scraper (быстрый), потом Sonar URL-read (~$0.005, ~10s).
  let bodyForValidation = item.body ?? "";
  let bodyQuality: "full" | "partial" | "headline_only" = bodyForValidation.length >= 800 ? "full" : "partial";
  if (bodyForValidation.length < 800 && item.url) {
    const enrichedBody = await tryEnrichBody(item.url, bodyForValidation);
    if (enrichedBody.length > bodyForValidation.length) {
      bodyForValidation = enrichedBody;
      bodyQuality = enrichedBody.length >= 1500 ? "full" : "partial";
    }
    if (bodyForValidation.length < 200) bodyQuality = "headline_only";
  }
  const post: PostForValidation = {
    title: item.title,
    body: bodyForValidation,
    url: item.url,
    published_at: item.published_at,
    body_quality: bodyQuality,
  };
  const prompt = buildValidatorPrompt(profile, post);
  const inputDump = `SYSTEM:\n${prompt.system}\n\n---\nUSER:\n${prompt.user}`;

  try {
    const res = await chatJson<unknown>({
      model: VALIDATOR_MODEL,
      system: prompt.system,
      user: prompt.user,
      temperature: 0.2,
      timeoutMs: CHAT_TIMEOUT_MS,
      requestId: item.id,
    });
    const parsed = validateValidatorOutput(res.parsed);
    if (!parsed) {
      // LLM ответил, но JSON не той формы — это всё равно "fail-soft":
      // помечаем как verdict=skip с пояснением, чтобы в "Отсеяно" было видно.
      await applyValidation(item.id, {
        status: "failed",
        validation_input: inputDump,
        validation_output_json: res.rawText.slice(0, 8000),
        validation_error: "validator returned non-conforming JSON",
        model_used: res.model,
        summary: null,
        value_explanation: null,
        matched_topics: null,
        relevance: null,
        verdict: null,
        reasoning: null,
      });
      await logError({
        level: "warn",
        source: "server",
        route: "news/cron/tick:validate_item",
        message: "validator returned non-conforming JSON",
        meta: { item_id: item.id, raw: res.rawText.slice(0, 500) },
      });
      return "failed";
    }
    await applyValidation(item.id, makeUpdate(parsed, res.rawText, res.model, inputDump));
    // Триггер enrichment: всё, что verdict=show, идёт в очередь под Opus
    // (v1.5 — без фильтра по depth, пользователь хочет полноценные статьи
    // для каждой релевантной новости).
    if (parsed.verdict === "show") {
      try {
        const query = item.title || item.body?.slice(0, 200) || "";
        if (query.trim()) {
          await enqueueEnrichment(item.id, query);
          console.log(`[news/tick] enqueued enrichment for ${item.id}`);
        }
      } catch (err) {
        await logError({
          level: "warn",
          source: "server",
          route: "news/cron/tick:enqueue_enrichment",
          message: err instanceof Error ? err.message : String(err),
          meta: { item_id: item.id },
        });
      }
    }
    return parsed.verdict;
  } catch (err) {
    await applyValidation(item.id, {
      status: "failed",
      validation_input: inputDump,
      validation_output_json: null,
      validation_error: errMsg(err),
      model_used: VALIDATOR_MODEL,
      summary: null,
      value_explanation: null,
      matched_topics: null,
      relevance: null,
      verdict: null,
      reasoning: null,
    });
    throw err;
  }
}

function makeUpdate(
  v: ValidatorOutput,
  rawText: string,
  model: string,
  inputDump: string,
) {
  const value = [v.value_for_user.actionable, v.value_for_user.worldview_fit, v.value_for_user.novelty]
    .filter((s) => s && s.trim())
    .join(" · ");
  return {
    status: "validated" as const,
    validation_input: inputDump,
    validation_output_json: rawText.slice(0, 8000),
    validation_error: null,
    model_used: model,
    summary: v.summary_1line || null,
    value_explanation: value || null,
    matched_topics: v.matched_topics,
    relevance: v.relevance,
    verdict: v.verdict,
    reasoning: v.reasoning || null,
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Дотягивание body перед валидацией. Каскад:
//   1. article-extract (HTML, ~5s) — для обычных страниц
//   2. sonarUrlRead (~10s, ~$0.005) — для paywall/SPA, у Perplexity
//      свой crawler с data-deals.
//   3. Apify article-extractor (~15s, ~$0.05) — последний герой для
//      JS-SPA и Cloudflare-блока. Только если есть APIFY_TOKEN.
// Soft-fail на каждый шаг — возвращаем лучшее что удалось.
async function tryEnrichBody(url: string, existing: string): Promise<string> {
  let best = existing;
  try {
    const art = await extractArticle(url);
    if (art.text && art.text.length > best.length && art.text.length >= 300) {
      best = art.text;
      if (best.length >= 1500) return best;
    }
  } catch {
    /* soft */
  }
  try {
    const read = await sonarUrlRead(url, { timeoutMs: 10_000 });
    if (read.text && read.text.length > best.length) {
      best = read.text;
      if (best.length >= 1500) return best;
    }
  } catch {
    /* soft */
  }
  if (best.length < 800 && process.env.APIFY_TOKEN) {
    try {
      const apify = await fetchArticleViaApify(url, { timeoutMs: 25_000 });
      if (apify.text && apify.text.length > best.length) {
        best = apify.text;
        console.log(`[news/validate] apify rescued ${url} (${apify.text.length} chars)`);
      }
    } catch (err) {
      console.log(`[news/validate] apify failed for ${url}: ${err instanceof Error ? err.message.slice(0,100) : "?"}`);
    }
  }
  return best;
}
