// Ядро модуля исследований: резюмируемый из БД агент древовидного поиска.
//
// Прогон = много дешёвых «тиков». Один tick = одна единица работы (планирование
// корня ИЛИ раскрытие одного узла: поиск → извлечение → реестр → оценка). Это
// влезает в таймаут serverless-функции; продвигают прогон cron или ручной вызов.
// Источник правды — БД (research_runs/nodes/findings), поэтому прогон переживает
// перезапуски и его можно «обходить» в визуализаторе.

import { chat, type Usage } from "./llm";
import { logServerError } from "../logger";
import { estimateCost, resolveParams } from "./config";
import { extractFactors, judgeNode } from "./extract";
import { mergeFindings } from "./ledger";
import { chatJSON } from "./llm";
import { childMessages, planMessages, synthesisMessages } from "./prompts";
import { search } from "./search";
import * as store from "./store";
import type {
  ExtractedFactor,
  ResearchParams,
  RunStats,
} from "./types";

export interface TickResult {
  progressed: boolean; // что-то сделали в этом тике
  done: boolean; // прогон завершён
  note: string;
}

export async function startRun(
  goal: string,
  override?: Partial<ResearchParams>,
): Promise<string> {
  const params = resolveParams(override);
  const run = await store.createRun(goal, params);
  await store.createNode({
    run_id: run.id,
    parent_id: null,
    depth: 0,
    kind: "root",
    question: goal,
  });
  return run.id;
}

export async function tick(runId: string): Promise<TickResult> {
  const run = await store.getRun(runId);
  if (!run) return { progressed: false, done: true, note: "прогон не найден" };
  if (run.status !== "running")
    return { progressed: false, done: true, note: `статус: ${run.status}` };

  // Бюджеты — до захвата узла, чтобы не брать работу впустую.
  if (run.stats.costUsd >= run.params.maxCostUsd)
    return finalize(runId, "достигнут бюджет стоимости");
  if (run.stats.nodesExpanded >= run.params.maxNodes)
    return finalize(runId, "достигнут потолок узлов");

  const node = await store.claimNextOpenNode(runId);
  if (!node) {
    const active = await store.countActiveNodes(runId);
    if (active > 0) return { progressed: false, done: false, note: "узлы в работе" };
    return finalize(runId, "фронтир пуст");
  }

  try {
    // --- ветка 1: планирование корня (декомпозиция цели) ---
    if (node.kind === "root") {
      const out = await planSubquestions(run.goal, run.params, false, node.question);
      for (const sq of out.subquestions) {
        await store.createNode({
          run_id: runId,
          parent_id: node.id,
          depth: 1,
          kind: "question",
          question: sq.question,
        });
      }
      const cost = costOf(run.params.reasoningModel, out.usage);
      await store.updateNode(node.id, {
        status: "expanded",
        summary: `Декомпозиция цели на ${out.subquestions.length} под-вопросов`,
        decision: "deepen",
        rationale: "Стартовая декомпозиция цели на непересекающиеся направления.",
        cost_usd: cost,
      });
      await bumpStats(runId, { ticks: 1, costUsd: cost });
      return {
        progressed: true,
        done: false,
        note: `запланировано под-вопросов: ${out.subquestions.length}`,
      };
    }

    // --- ветка 2: раскрытие узла-вопроса ---
    const so = await search(
      node.question,
      run.params.searchResults,
      run.params.searchProvider,
      run.params.searchModel,
    );
    const ex = await extractFactors(
      run.goal,
      node.question,
      so.text,
      so.sources,
      run.params.extractModel,
    );
    const merge = await mergeFindings(runId, node.id, ex.factors, so.sources);
    const total = ex.factors.length;
    const novelty = total ? merge.inserted / total : 0;

    const jg = await judgeNode(
      run.goal,
      node.question,
      ex.factors.map((f) => f.factor),
      total,
      merge.inserted,
      run.params.reasoningModel,
    );

    let cost =
      so.costUsd +
      costOf(run.params.extractModel, ex.usage) +
      costOf(run.params.reasoningModel, jg.usage);

    // Углубление (фаза 2): создаём детей, если ветка перспективна и есть глубина.
    let childrenNote = "";
    if (
      node.depth < run.params.maxDepth &&
      jg.decision === "deepen" &&
      jg.promise >= 0.5 &&
      total > 0
    ) {
      const kids = await planSubquestions(
        run.goal,
        run.params,
        true,
        node.question,
        ex.factors,
      );
      for (const sq of kids.subquestions) {
        await store.createNode({
          run_id: runId,
          parent_id: node.id,
          depth: node.depth + 1,
          kind: "question",
          question: sq.question,
        });
      }
      cost += costOf(run.params.reasoningModel, kids.usage);
      childrenNote = `, +${kids.subquestions.length} под-узлов`;
    }

    await store.updateNode(node.id, {
      status: total === 0 ? "exhausted" : "expanded",
      query: node.question,
      sources: so.sources,
      summary: summarize(ex.factors),
      scores: {
        relevance: jg.relevance,
        novelty,
        evidence: jg.evidence,
        promise: jg.promise,
      },
      decision: jg.decision,
      rationale: jg.reasoning,
      cost_usd: cost,
    });
    await bumpStats(runId, {
      ticks: 1,
      nodesExpanded: 1,
      searches: 1,
      costUsd: cost,
      findings: merge.inserted,
    });
    return {
      progressed: true,
      done: false,
      note: `+${merge.inserted} новых факторов (${merge.merged} объединено)${childrenNote}`,
    };
  } catch (err) {
    await logServerError(err, "/lib/research/engine.tick", {
      runId,
      nodeId: node.id,
    });
    await store.updateNode(node.id, {
      status: "error",
      rationale: err instanceof Error ? err.message : String(err),
    });
    await bumpStats(runId, { ticks: 1 });
    return { progressed: true, done: false, note: "ошибка узла (записана в app_errors)" };
  }
}

// Прокрутить прогон на несколько тиков в рамках одного вызова (cron/ручной),
// уважая дедлайн по времени, чтобы не превысить таймаут функции.
export async function tickRun(
  runId: string,
  maxTicks: number,
  deadlineMs: number,
): Promise<{ ticks: number; done: boolean; lastNote: string }> {
  let ticks = 0;
  let lastNote = "";
  for (let i = 0; i < maxTicks; i++) {
    if (Date.now() > deadlineMs) break;
    const r = await tick(runId);
    lastNote = r.note;
    if (r.progressed) ticks++;
    if (r.done) return { ticks, done: true, lastNote };
    if (!r.progressed) break; // нет открытых узлов прямо сейчас
  }
  return { ticks, done: false, lastNote };
}

// --- финал: синтез отчёта по реестру ---

async function finalize(runId: string, reason: string): Promise<TickResult> {
  const run = await store.getRun(runId);
  if (!run || run.status !== "running") {
    return { progressed: false, done: true, note: `статус: ${run?.status ?? "?"}` };
  }

  const findings = await store.listFindings(runId);
  let report = "";
  let cost = 0;
  try {
    const block = findings
      .map(
        (f) =>
          `- ${f.factor} [${f.direction}, conf ${f.confidence.toFixed(2)}, упоминаний ${f.mentions}]: ${f.description}`,
      )
      .join("\n");
    const r = await chat({
      model: run.params.reasoningModel,
      temperature: 0,
      maxTokens: 2200,
      messages: synthesisMessages(run.goal, block || "(реестр пуст)"),
    });
    report = r.content;
    cost = costOf(run.params.reasoningModel, r.usage);
  } catch (err) {
    await logServerError(err, "/lib/research/engine.finalize", { runId });
    report = `(синтез не удался). Найдено факторов: ${findings.length}.`;
  }

  const stats = addStats(run.stats, { costUsd: cost });
  await store.updateRun(runId, {
    status: "done",
    report,
    stats,
    finished_at: new Date().toISOString(),
  });
  return {
    progressed: true,
    done: true,
    note: `готово (${reason}); факторов: ${findings.length}`,
  };
}

// --- планирование под-вопросов ---

interface Subq {
  question: string;
  angle: string;
}
async function planSubquestions(
  goal: string,
  params: ResearchParams,
  deeper: boolean,
  parentQuestion: string,
  factors: ExtractedFactor[] = [],
): Promise<{ subquestions: Subq[]; usage: Usage }> {
  const messages = deeper
    ? childMessages(goal, parentQuestion, factors, params)
    : planMessages(goal, params);
  const { data, usage } = await chatJSON<{ subquestions?: unknown[] }>({
    model: params.reasoningModel,
    temperature: 0.3,
    maxTokens: 1200,
    messages,
  });
  return { subquestions: parseSubq(data.subquestions, params.fanout), usage };
}

function parseSubq(raw: unknown[] | undefined, cap: number): Subq[] {
  if (!Array.isArray(raw)) return [];
  const out: Subq[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const q = typeof o.question === "string" ? o.question.trim() : "";
    if (!q) continue;
    out.push({ question: q, angle: typeof o.angle === "string" ? o.angle : "" });
    if (out.length >= cap) break;
  }
  return out;
}

function summarize(factors: ExtractedFactor[]): string {
  if (factors.length === 0) return "Ничего релевантного не найдено.";
  const names = factors.slice(0, 6).map((f) => f.factor);
  const more = factors.length > 6 ? ` и ещё ${factors.length - 6}` : "";
  return `Факторы: ${names.join(", ")}${more}.`;
}

// --- стоимость и статистика ---

function costOf(model: string, usage: Usage): number {
  return (
    usage.costUsd ??
    estimateCost(model, usage.promptTokens, usage.completionTokens)
  );
}

function addStats(base: RunStats, delta: Partial<RunStats>): RunStats {
  return {
    nodesExpanded: base.nodesExpanded + (delta.nodesExpanded ?? 0),
    findings: base.findings + (delta.findings ?? 0),
    searches: base.searches + (delta.searches ?? 0),
    costUsd: base.costUsd + (delta.costUsd ?? 0),
    ticks: base.ticks + (delta.ticks ?? 0),
  };
}

// Перечитывает текущую статистику и добавляет дельту — сужает окно гонки при
// перекрытии cron- и ручных тиков (полностью атомарно сделаем в фазе 2).
async function bumpStats(runId: string, delta: Partial<RunStats>): Promise<void> {
  const run = await store.getRun(runId);
  if (!run) return;
  await store.updateRun(runId, { stats: addStats(run.stats, delta) });
}
