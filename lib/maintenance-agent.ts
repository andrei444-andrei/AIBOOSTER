// LLM-агент аудита системы. Раз в 30 мин:
// 1. Собирает сигналы (collectSignals).
// 2. Скармливает Opus 4.8 с инструкциями + whitelist tools.
// 3. Получает JSON-план действий.
// 4. Выполняет действия через белый список handlers с anti-loop защитой.
// 5. Записывает run + actions в БД.

import { chatJson } from "./aimlapi";
import { collectSignals, type MaintenanceSignals } from "./maintenance-collect";
import {
  createMaintenanceRun,
  finalizeMaintenanceRun,
  recordMaintenanceAction,
} from "./maintenance-db";
import {
  retryEnrichmentAction,
  deactivateSourceAction,
  rediscoverSourceAction,
  archiveItemAction,
  noteFindingAction,
} from "./maintenance-actions";

const AGENT_MODEL = "claude-opus-4-8";
const AGENT_TIMEOUT_MS = 60_000;
const MAX_ACTIONS_PER_RUN = 20;

interface PlannedAction {
  action: "retry_enrichment" | "deactivate_source" | "rediscover_source" | "archive_item" | "note_finding";
  target_id?: string;
  text?: string; // для note_finding
  reason: string;
}

interface AgentResponse {
  reasoning: string;
  actions: PlannedAction[];
}

const SYSTEM_PROMPT = `Ты — maintenance-агент для AI-новостной системы. Раз в 30 минут ты получаешь сводку:
ошибки enrichment'а (Opus синтезирует полные статьи), здоровье источников,
свежие app_errors. Твоя задача — РЕАЛЬНО улучшить систему, применив до 20
действий из whitelist.

ДЕЙСТВИЯ (только эти 5, ничего больше):

1. retry_enrichment(target_id=item.id) — переставить пост в очередь enrichment.
   Используй когда: ошибка transient (timeout, 502, parse JSON) И retry_count < 3.
   НЕ используй: если ошибка явно структурная (paywall fully blocked, content
   unparseable от природы) — лучше archive_item.

2. archive_item(target_id=item.id) — скрыть пост из ленты.
   Используй когда: enrichment упал 3+ раза подряд, или контент явно мусор/
   реклама, или попал в show по ошибке (нерелевантный пост).

3. deactivate_source(target_id=source.id) — выключить источник.
   Используй когда: источник стабильно отдаёт 404/403/dns/timeout И за 24ч
   ноль items. Это «мёртвый» источник.

4. rediscover_source(target_id=source.id) — попробовать найти новый feed URL
   через homepage (RSS-discover → web-fallback).
   Используй когда: источник был валидным, но текущий URL отдаёт 404,
   возможно feed переехал.

5. note_finding(text="...") — записать наблюдение для человека.
   Используй когда: видишь паттерн, который не лечится whitelisted-действиями,
   ИЛИ не уверен, ИЛИ если хочется попросить человека что-то сделать.

ПРАВИЛА:

- Качество > количество. Лучше 3 точных действия, чем 20 слабых.
- Если ситуация в норме (мало ошибок, всё работает) — пустой actions=[]. Это OK.
- НИКОГДА не предлагай action кроме whitelist'a.
- target_id должен быть точный id из signal'а; не выдумывай.
- reason — короткая фраза (до 200 chars) почему именно это действие.
- В reasoning поле объясни общую картину (категоризация ошибок) за 3-5 предложений.

ФОРМАТ ОТВЕТА (СТРОГО JSON, без markdown):
{
  "reasoning": "Сейчас вижу 7 failed enrichments — все из-за timeout Opus. Источник X стабильно 404 — мёртвый. 2 поста о криптокошельках попали в show — нерелевант.",
  "actions": [
    {"action": "retry_enrichment", "target_id": "abc-123", "reason": "transient opus timeout, retry 1/3"},
    {"action": "deactivate_source", "target_id": "src-456", "reason": "404 за 24ч, мёртвый"},
    {"action": "archive_item", "target_id": "itm-789", "reason": "крипта, не моя тема"},
    {"action": "note_finding", "text": "5 постов от techmeme.com за день — слишком общий, рассмотри убрать"}
  ]
}`;

export interface AuditResult {
  run_id: string;
  status: "done" | "error";
  applied: number;
  skipped: number;
  errored: number;
  cost_cents: number | null;
  latency_ms: number;
  summary: string;
  error?: string;
}

export async function runMaintenanceAudit(): Promise<AuditResult> {
  const runId = await createMaintenanceRun();
  const t0 = Date.now();
  let signals: MaintenanceSignals;
  try {
    signals = await collectSignals();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finalizeMaintenanceRun(runId, {
      status: "error",
      error: `collect: ${msg.slice(0, 500)}`,
      latency_ms: Date.now() - t0,
    });
    return {
      run_id: runId,
      status: "error",
      applied: 0,
      skipped: 0,
      errored: 0,
      cost_cents: null,
      latency_ms: Date.now() - t0,
      summary: "collect failed",
      error: msg,
    };
  }

  // Если в системе всё спокойно — ничего не дёргаем.
  const hasWork =
    signals.failed_enrichments.length > 0 ||
    signals.stuck_running_enrichments > 0 ||
    signals.broken_sources_404_or_403.length > 0 ||
    signals.recent_app_errors.length >= 3;

  if (!hasWork) {
    await finalizeMaintenanceRun(runId, {
      status: "done",
      signals_json: JSON.stringify(signals).slice(0, 16_000),
      summary: "система в норме — ничего не сделано",
      latency_ms: Date.now() - t0,
    });
    return {
      run_id: runId,
      status: "done",
      applied: 0,
      skipped: 0,
      errored: 0,
      cost_cents: 0,
      latency_ms: Date.now() - t0,
      summary: "система в норме — ничего не сделано",
    };
  }

  // Готовим компактный JSON-снимок для Opus.
  const userPayload = buildUserMessage(signals);

  let plan: AgentResponse | null = null;
  let opusCost = 0;
  let opusLatency = 0;
  try {
    const res = await chatJson<AgentResponse>({
      model: AGENT_MODEL,
      system: SYSTEM_PROMPT,
      user: userPayload,
      temperature: 0.2,
      timeoutMs: AGENT_TIMEOUT_MS,
      maxTokens: 4096,
    });
    plan = res.parsed;
    opusLatency = res.latencyMs;
    // Грубая оценка Opus 4.8: input ~length/4 tokens × $15/M + output × $75/M.
    const inT = Math.ceil((SYSTEM_PROMPT.length + userPayload.length) / 4);
    const outT = Math.ceil(res.rawText.length / 4);
    opusCost = Math.ceil((inT * 0.000015 + outT * 0.000075) * 100);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finalizeMaintenanceRun(runId, {
      status: "error",
      signals_json: JSON.stringify(signals).slice(0, 16_000),
      error: `opus: ${msg.slice(0, 500)}`,
      latency_ms: Date.now() - t0,
    });
    return {
      run_id: runId,
      status: "error",
      applied: 0,
      skipped: 0,
      errored: 0,
      cost_cents: null,
      latency_ms: Date.now() - t0,
      summary: "opus failed",
      error: msg,
    };
  }

  // Валидация плана и обрезка под MAX_ACTIONS_PER_RUN.
  const rawActions = Array.isArray(plan?.actions) ? plan.actions : [];
  const validActions: PlannedAction[] = [];
  for (const a of rawActions) {
    if (!a || typeof a !== "object") continue;
    const action = (a as PlannedAction).action;
    const target_id = (a as PlannedAction).target_id;
    const text = (a as PlannedAction).text;
    const reason = (a as PlannedAction).reason;
    if (!action || typeof reason !== "string") continue;
    if (action === "note_finding") {
      if (typeof text !== "string" || !text.trim()) continue;
      validActions.push({ action, text: text.trim(), reason: reason.slice(0, 500) });
    } else if (
      action === "retry_enrichment" ||
      action === "deactivate_source" ||
      action === "rediscover_source" ||
      action === "archive_item"
    ) {
      if (typeof target_id !== "string" || !target_id.trim()) continue;
      validActions.push({ action, target_id: target_id.trim(), reason: reason.slice(0, 500) });
    }
    if (validActions.length >= MAX_ACTIONS_PER_RUN) break;
  }

  let applied = 0;
  let skipped = 0;
  let errored = 0;
  for (const a of validActions) {
    let result: { result: "ok" | "skipped" | "error"; message: string };
    try {
      if (a.action === "retry_enrichment") {
        result = await retryEnrichmentAction(a.target_id!, a.reason);
      } else if (a.action === "deactivate_source") {
        result = await deactivateSourceAction(a.target_id!, a.reason);
      } else if (a.action === "rediscover_source") {
        result = await rediscoverSourceAction(a.target_id!, a.reason);
      } else if (a.action === "archive_item") {
        result = await archiveItemAction(a.target_id!, a.reason);
      } else {
        result = await noteFindingAction(a.text!);
      }
    } catch (err) {
      result = { result: "error", message: err instanceof Error ? err.message : String(err) };
    }

    if (result.result === "ok") applied++;
    else if (result.result === "skipped") skipped++;
    else errored++;

    await recordMaintenanceAction(runId, {
      type: a.action,
      target_id: a.target_id ?? null,
      reason: a.reason + (result.message ? ` | ${result.message}` : ""),
      result: result.result,
      error: result.result === "error" ? result.message : null,
    });
  }

  const summary = `${applied} применено · ${skipped} пропущено · ${errored} ошибок · cost ${opusCost}¢`;
  await finalizeMaintenanceRun(runId, {
    status: "done",
    signals_json: JSON.stringify(signals).slice(0, 16_000),
    agent_reasoning: (plan.reasoning ?? "").slice(0, 4000),
    action_plan_json: JSON.stringify(validActions).slice(0, 8000),
    cost_cents: opusCost,
    latency_ms: Date.now() - t0,
    summary,
  });

  return {
    run_id: runId,
    status: "done",
    applied,
    skipped,
    errored,
    cost_cents: opusCost,
    latency_ms: Date.now() - t0,
    summary,
  };
}

function buildUserMessage(s: MaintenanceSignals): string {
  // Компактируем — Opus всё равно не нуждается в полном дампе.
  const compactSources = s.source_health
    .filter((h) => h.failed_enrich_24h > 0 || h.total_items_24h === 0 || h.recent_errors.length > 0)
    .slice(0, 25)
    .map((h) => ({
      id: h.source_id,
      name: h.name,
      url: h.url,
      kind: h.kind,
      active: h.active,
      last_fetched_at: h.last_fetched_at,
      items_24h: h.total_items_24h,
      failed_enrich_24h: h.failed_enrich_24h,
      recent_errors: h.recent_errors,
    }));

  const overview = {
    collected_at: s.collected_at,
    enrichment_24h: {
      total: s.enrichment_24h_total,
      success: s.enrichment_24h_success,
      failed: s.enrichment_24h_failed,
      success_rate:
        s.enrichment_24h_total > 0
          ? Math.round((s.enrichment_24h_success / s.enrichment_24h_total) * 100) + "%"
          : "n/a",
    },
    stuck_running: s.stuck_running_enrichments,
    failed_enrichments_total: s.failed_enrichments_total,
    failed_enrichments_recent: s.failed_enrichments.slice(0, 10),
    broken_sources_candidates: s.broken_sources_404_or_403.map((h) => ({
      id: h.source_id,
      name: h.name,
      url: h.url,
      recent_errors: h.recent_errors,
    })),
    sources_with_problems: compactSources,
    recent_app_errors: s.recent_app_errors,
  };

  return `Картина состояния системы:\n\`\`\`json\n${JSON.stringify(overview, null, 2)}\n\`\`\`\n\nРеши, какие действия применить (макс 20). Verbose reasoning + actions JSON.`;
}
