// Слой доступа к БД для модуля исследований. Таблицы заведены в lib/schema.ts
// (самопровижининг, CONSTITUTION §1). Здесь — CRUD и мапперы строк.

import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "../db";
import type {
  FindingRow,
  NodeKind,
  NodeRow,
  NodeScores,
  NodeStatus,
  ResearchParams,
  RunRow,
  RunStats,
  SearchSource,
} from "./types";

const EMPTY_STATS: RunStats = {
  nodesExpanded: 0,
  findings: 0,
  searches: 0,
  costUsd: 0,
  ticks: 0,
};

type Row = Record<string, unknown>;

// ---------- runs ----------

export async function createRun(
  goal: string,
  params: ResearchParams,
): Promise<RunRow> {
  await ensureSchema();
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO research_runs
            (id, goal, status, params, stats, report, error, created_at, updated_at, finished_at)
          VALUES (?, ?, 'running', ?, ?, NULL, NULL, ?, ?, NULL)`,
    args: [id, goal, JSON.stringify(params), JSON.stringify(EMPTY_STATS), now, now],
  });
  const run = await getRun(id);
  if (!run) throw new Error("failed to create run");
  return run;
}

export async function getRun(id: string): Promise<RunRow | null> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({ sql: `SELECT * FROM research_runs WHERE id = ?`, args: [id] });
  const row = res.rows[0] as Row | undefined;
  return row ? mapRun(row) : null;
}

export async function listRuns(limit = 50): Promise<RunRow[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM research_runs ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return (res.rows as unknown as Row[]).map(mapRun);
}

export async function listRunningRuns(limit = 20): Promise<RunRow[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM research_runs WHERE status = 'running' ORDER BY created_at ASC LIMIT ?`,
    args: [limit],
  });
  return (res.rows as unknown as Row[]).map(mapRun);
}

export interface RunPatch {
  status?: RunRow["status"];
  stats?: RunStats;
  report?: string | null;
  error?: string | null;
  finished_at?: string | null;
}
export async function updateRun(id: string, patch: RunPatch): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const sets: string[] = ["updated_at = ?"];
  const args: (string | number | null)[] = [new Date().toISOString()];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    args.push(patch.status);
  }
  if (patch.stats !== undefined) {
    sets.push("stats = ?");
    args.push(JSON.stringify(patch.stats));
  }
  if (patch.report !== undefined) {
    sets.push("report = ?");
    args.push(patch.report);
  }
  if (patch.error !== undefined) {
    sets.push("error = ?");
    args.push(patch.error);
  }
  if (patch.finished_at !== undefined) {
    sets.push("finished_at = ?");
    args.push(patch.finished_at);
  }
  args.push(id);
  await db.execute({ sql: `UPDATE research_runs SET ${sets.join(", ")} WHERE id = ?`, args });
}

// ---------- nodes ----------

export interface NewNode {
  run_id: string;
  parent_id: string | null;
  depth: number;
  kind: NodeKind;
  question: string;
}
export async function createNode(n: NewNode): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO research_nodes
            (id, run_id, parent_id, depth, kind, question, status, query, sources,
             summary, scores, decision, rationale, cost_usd, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'open', NULL, NULL, NULL, NULL, NULL, NULL, 0, ?, ?)`,
    args: [id, n.run_id, n.parent_id, n.depth, n.kind, n.question, now, now],
  });
  return id;
}

export async function listNodes(runId: string): Promise<NodeRow[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM research_nodes WHERE run_id = ? ORDER BY created_at ASC`,
    args: [runId],
  });
  return (res.rows as unknown as Row[]).map(mapNode);
}

// Сколько узлов ещё в работе (open|searching) — чтобы понять, завершён ли прогон.
export async function countActiveNodes(runId: string): Promise<number> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM research_nodes
          WHERE run_id = ? AND status IN ('open','searching')`,
    args: [runId],
  });
  return Number((res.rows[0] as Row | undefined)?.n ?? 0);
}

// Атомарно «захватывает» один открытый узел: помечает его searching и возвращает.
// Сортировка по promise DESC (фронтир best-first), затем по depth/created_at.
// RETURNING делает выбор+пометку одной операцией — защита от двойного взятия
// при перекрытии cron- и ручных тиков.
export async function claimNextOpenNode(runId: string): Promise<NodeRow | null> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const res = await db.execute({
    sql: `UPDATE research_nodes
          SET status = 'searching', updated_at = ?
          WHERE id = (
            SELECT id FROM research_nodes
            WHERE run_id = ? AND status = 'open'
            ORDER BY COALESCE(json_extract(scores,'$.promise'), -1) DESC,
                     depth ASC, created_at ASC
            LIMIT 1
          )
          RETURNING *`,
    args: [now, runId],
  });
  const row = res.rows[0] as Row | undefined;
  return row ? mapNode(row) : null;
}

export interface NodePatch {
  status?: NodeStatus;
  query?: string | null;
  sources?: SearchSource[];
  summary?: string | null;
  scores?: NodeScores | null;
  decision?: string | null;
  rationale?: string | null;
  cost_usd?: number;
}
export async function updateNode(id: string, patch: NodePatch): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const sets: string[] = ["updated_at = ?"];
  const args: (string | number | null)[] = [new Date().toISOString()];
  const push = (col: string, val: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };
  if (patch.status !== undefined) push("status", patch.status);
  if (patch.query !== undefined) push("query", patch.query);
  if (patch.sources !== undefined) push("sources", JSON.stringify(patch.sources));
  if (patch.summary !== undefined) push("summary", patch.summary);
  if (patch.scores !== undefined)
    push("scores", patch.scores ? JSON.stringify(patch.scores) : null);
  if (patch.decision !== undefined) push("decision", patch.decision);
  if (patch.rationale !== undefined) push("rationale", patch.rationale);
  if (patch.cost_usd !== undefined) push("cost_usd", patch.cost_usd);
  args.push(id);
  await db.execute({ sql: `UPDATE research_nodes SET ${sets.join(", ")} WHERE id = ?`, args });
}

// ---------- findings ----------

export async function listFindings(runId: string): Promise<FindingRow[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM research_findings WHERE run_id = ?
          ORDER BY mentions DESC, confidence DESC, created_at ASC`,
    args: [runId],
  });
  return (res.rows as unknown as Row[]).map(mapFinding);
}

export async function getFindingByNorm(
  runId: string,
  norm: string,
): Promise<FindingRow | null> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM research_findings WHERE run_id = ? AND factor_norm = ? LIMIT 1`,
    args: [runId, norm],
  });
  const row = res.rows[0] as Row | undefined;
  return row ? mapFinding(row) : null;
}

export interface NewFinding {
  run_id: string;
  factor: string;
  factor_norm: string;
  description: string;
  direction: FindingRow["direction"];
  confidence: number;
  evidence: string[];
  sources: SearchSource[];
  node_ids: string[];
}
export async function insertFinding(f: NewFinding): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO research_findings
            (id, run_id, factor, factor_norm, description, direction, confidence,
             evidence, sources, node_ids, mentions, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    args: [
      id,
      f.run_id,
      f.factor,
      f.factor_norm,
      f.description,
      f.direction,
      f.confidence,
      JSON.stringify(f.evidence),
      JSON.stringify(f.sources),
      JSON.stringify(f.node_ids),
      now,
      now,
    ],
  });
}

export async function updateFinding(
  id: string,
  patch: {
    description?: string;
    confidence?: number;
    evidence?: string[];
    sources?: SearchSource[];
    node_ids?: string[];
    mentions?: number;
  },
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const sets: string[] = ["updated_at = ?"];
  const args: (string | number | null)[] = [new Date().toISOString()];
  const push = (col: string, val: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };
  if (patch.description !== undefined) push("description", patch.description);
  if (patch.confidence !== undefined) push("confidence", patch.confidence);
  if (patch.evidence !== undefined) push("evidence", JSON.stringify(patch.evidence));
  if (patch.sources !== undefined) push("sources", JSON.stringify(patch.sources));
  if (patch.node_ids !== undefined) push("node_ids", JSON.stringify(patch.node_ids));
  if (patch.mentions !== undefined) push("mentions", patch.mentions);
  args.push(id);
  await db.execute({ sql: `UPDATE research_findings SET ${sets.join(", ")} WHERE id = ?`, args });
}

// ---------- мапперы ----------

function mapRun(r: Row): RunRow {
  return {
    id: String(r.id),
    goal: String(r.goal),
    status: String(r.status) as RunRow["status"],
    params: parseJson<ResearchParams>(r.params, {} as ResearchParams),
    stats: parseJson<RunStats>(r.stats, EMPTY_STATS),
    report: r.report == null ? null : String(r.report),
    error: r.error == null ? null : String(r.error),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    finished_at: r.finished_at == null ? null : String(r.finished_at),
  };
}

function mapNode(r: Row): NodeRow {
  return {
    id: String(r.id),
    run_id: String(r.run_id),
    parent_id: r.parent_id == null ? null : String(r.parent_id),
    depth: Number(r.depth),
    kind: String(r.kind) as NodeKind,
    question: String(r.question),
    status: String(r.status) as NodeStatus,
    query: r.query == null ? null : String(r.query),
    sources: parseJson<SearchSource[]>(r.sources, []),
    summary: r.summary == null ? null : String(r.summary),
    scores: r.scores == null ? null : parseJson<NodeScores | null>(r.scores, null),
    decision: r.decision == null ? null : String(r.decision),
    rationale: r.rationale == null ? null : String(r.rationale),
    cost_usd: Number(r.cost_usd ?? 0),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function mapFinding(r: Row): FindingRow {
  return {
    id: String(r.id),
    run_id: String(r.run_id),
    factor: String(r.factor),
    description: String(r.description ?? ""),
    direction: String(r.direction) as FindingRow["direction"],
    confidence: Number(r.confidence ?? 0),
    evidence: parseJson<string[]>(r.evidence, []),
    sources: parseJson<SearchSource[]>(r.sources, []),
    node_ids: parseJson<string[]>(r.node_ids, []),
    mentions: Number(r.mentions ?? 1),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v !== "string") return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
