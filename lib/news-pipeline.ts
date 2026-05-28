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
const VALIDATE_BATCH = 10;
const MAX_ITEMS_PER_SOURCE = 20;
const APIFY_RUN_TIMEOUT_MIN = 15;

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

  // Сидим дефолты — после ensureSchema (вызывается внутри news.ts функций).
  try {
    stats.seeded_profile = await seedProfileIfEmpty();
  } catch (err) {
    await logServerError(err, "news/cron/tick:seed_profile");
    stats.errors.push(`seed_profile: ${errMsg(err)}`);
  }
  try {
    stats.seeded_sources = await seedSourcesIfEmpty();
  } catch (err) {
    await logServerError(err, "news/cron/tick:seed_sources");
    stats.errors.push(`seed_sources: ${errMsg(err)}`);
  }

  // Фаза 1: фетч одного due-источника.
  let source: NewsSourceRow | null = null;
  try {
    source = await claimDueSource(workerId);
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

  // Фаза 2: валидация pending-items.
  let pending: NewsItemRow[] = [];
  try {
    pending = await getPendingItems(VALIDATE_BATCH);
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
      return stats;
    }

    for (const item of pending) {
      try {
        const result = await validateOne(item, profile);
        if (result === "failed") {
          stats.validation_failed++;
        } else {
          stats.validated++;
          if (result === "show") stats.validated_show++;
          else if (result === "skip") stats.validated_skip++;
        }
      } catch (err) {
        stats.validation_failed++;
        await logServerError(err, "news/cron/tick:validate_item", {
          item_id: item.id,
          source_id: item.source_id,
        });
      }
    }
  }

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
