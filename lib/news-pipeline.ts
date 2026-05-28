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
  setApifyRun,
  updateApifyStatus,
  insertRawItem,
  getPendingItems,
  applyValidation,
  getActiveProfile,
  seedProfileIfEmpty,
  seedSourcesIfEmpty,
  type NewsSourceRow,
  type NewsItemRow,
} from "./news";
import {
  startTelegramRun,
  getRunStatus,
  fetchRunDataset,
} from "./apify-tg";
import { fetchRss, stripHtml } from "./rss";
import { chatJson } from "./aimlapi";
import {
  buildValidatorPrompt,
  validateValidatorOutput,
  type ValidatorOutput,
  type InterestProfile,
  type PostForValidation,
} from "./news-prompt";

const VALIDATOR_MODEL = "claude-sonnet-4-6";
// Размер батча валидации намеренно небольшой: каждая валидация ~3-8 сек,
// плюс фаза фетча (~5-15 сек на RSS). За один tick укладываемся в ~30-40 сек,
// оставляя запас от лимита maxDuration=60. Сидящие pending подберёт
// следующий тик через 10 минут.
const VALIDATE_BATCH = 3;
const MAX_ITEMS_PER_SOURCE = 20;
const APIFY_RUN_TIMEOUT_MIN = 15;
// Если до конца maxDuration осталось меньше — не запускаем новую валидацию.
const VALIDATION_TIME_BUDGET_MS = 50_000;
// Каждый LLM-вызов сам себя режет — но и в pipeline ставим страховку,
// чтобы один зависший вызов не уносил остальные.
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
      // отпустим лок чтобы next tick попробовал снова
      await releaseSource(source.id).catch(() => {});
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

async function processTelegramSource(
  source: NewsSourceRow,
  stats: TickStats,
): Promise<string> {
  if (!process.env.APIFY_TOKEN) {
    stats.warnings.push("APIFY_TOKEN not set — telegram source skipped");
    await releaseSource(source.id);
    return "skipped_no_token";
  }

  // Есть активный run — проверяем его статус.
  if (source.apify_run_id) {
    const startedAt = source.apify_run_started_at
      ? Date.parse(source.apify_run_started_at)
      : 0;
    const ageMin = (Date.now() - startedAt) / 60_000;
    if (ageMin > APIFY_RUN_TIMEOUT_MIN) {
      // Зависший run — сбрасываем и стартанём новый на следующем tick'е.
      stats.warnings.push(
        `apify run ${source.apify_run_id} timed out (${Math.round(ageMin)}min) — resetting`,
      );
      await setApifyRun(source.id, null, "ABANDONED");
      await releaseSource(source.id);
      return "reset_stale_run";
    }

    const info = await getRunStatus(source.apify_run_id);
    await updateApifyStatus(source.id, info.status);
    if (info.status === "SUCCEEDED" && info.datasetId) {
      // Сначала чистим run_id и помечаем источник как fetched. Если потом
      // что-то рухнет на вставке — у нас не будет залипшего run_id, который
      // на следующем tick'е попробует повторно тянуть тот же dataset.
      // Дедуп по (source_id, external_id) защищает от потери данных при
      // повторной выборке dataset'а если что-то прерывалось.
      await setApifyRun(source.id, null, info.status);
      await setSourceFetched(source.id);

      const posts = await fetchRunDataset(info.datasetId);
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
      return `harvested_${inserted}_of_${posts.length}`;
    }
    if (info.status === "FAILED" || info.status === "ABORTED" || info.status === "TIMED-OUT") {
      stats.warnings.push(`apify run ${source.apify_run_id} ended: ${info.status}`);
      await setApifyRun(source.id, null, info.status);
      await releaseSource(source.id);
      return `apify_${info.status.toLowerCase()}`;
    }
    // RUNNING / READY — отпускаем лок, ждём следующий tick.
    await releaseSource(source.id);
    return `apify_${info.status.toLowerCase()}`;
  }

  // Нет активного run — стартуем.
  const run = await startTelegramRun(source.url);
  await setApifyRun(source.id, run.id, run.status);
  await releaseSource(source.id);
  return `started_run_${run.id}`;
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
  const post: PostForValidation = {
    title: item.title,
    body: item.body ?? "",
    url: item.url,
    published_at: item.published_at,
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
