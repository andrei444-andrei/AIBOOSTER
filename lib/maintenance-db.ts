// CRUD для maintenance_runs / maintenance_actions.

import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "./db";

export type MaintenanceRunStatus = "running" | "done" | "error";
export type MaintenanceActionResult = "ok" | "skipped" | "error";
export type MaintenanceActionType =
  | "retry_enrichment"
  | "deactivate_source"
  | "rediscover_source"
  | "archive_item"
  | "note_finding";

export interface MaintenanceRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: MaintenanceRunStatus;
  signals_json: string | null;
  agent_reasoning: string | null;
  action_plan_json: string | null;
  cost_cents: number | null;
  latency_ms: number | null;
  error: string | null;
  summary: string | null;
}

export interface MaintenanceActionRow {
  id: string;
  run_id: string;
  action_type: MaintenanceActionType;
  target_id: string | null;
  reason: string | null;
  applied_at: string;
  result: MaintenanceActionResult;
  error: string | null;
}

export async function createMaintenanceRun(): Promise<string> {
  await ensureSchema();
  const db = getDb();
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO maintenance_runs (id, status) VALUES (?, 'running')`,
    args: [id],
  });
  return id;
}

export async function finalizeMaintenanceRun(
  id: string,
  payload: {
    status: MaintenanceRunStatus;
    signals_json?: string | null;
    agent_reasoning?: string | null;
    action_plan_json?: string | null;
    cost_cents?: number | null;
    latency_ms?: number | null;
    error?: string | null;
    summary?: string | null;
  },
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE maintenance_runs
          SET status = ?,
              signals_json = COALESCE(?, signals_json),
              agent_reasoning = COALESCE(?, agent_reasoning),
              action_plan_json = COALESCE(?, action_plan_json),
              cost_cents = COALESCE(?, cost_cents),
              latency_ms = COALESCE(?, latency_ms),
              error = COALESCE(?, error),
              summary = COALESCE(?, summary),
              finished_at = datetime('now')
          WHERE id = ?`,
    args: [
      payload.status,
      payload.signals_json ?? null,
      payload.agent_reasoning ?? null,
      payload.action_plan_json ?? null,
      payload.cost_cents ?? null,
      payload.latency_ms ?? null,
      payload.error ?? null,
      payload.summary ?? null,
      id,
    ],
  });
}

export async function recordMaintenanceAction(
  runId: string,
  action: {
    type: MaintenanceActionType;
    target_id: string | null;
    reason: string;
    result: MaintenanceActionResult;
    error?: string | null;
  },
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO maintenance_actions (id, run_id, action_type, target_id, reason, result, error)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      randomUUID(),
      runId,
      action.type,
      action.target_id,
      action.reason.slice(0, 1000),
      action.result,
      action.error?.slice(0, 1000) ?? null,
    ],
  });
}

/** Антитоп: было ли уже такое же действие (action_type + target_id) применено
 *  с result='ok' за последние windowHours часов? */
export async function wasActionAppliedRecently(
  actionType: MaintenanceActionType,
  targetId: string,
  windowHours = 24,
): Promise<boolean> {
  await ensureSchema();
  const db = getDb();
  const cutoff = new Date(Date.now() - windowHours * 3600_000).toISOString();
  const res = await db.execute({
    sql: `SELECT 1 FROM maintenance_actions
          WHERE action_type = ? AND target_id = ? AND result = 'ok'
            AND applied_at > ?
          LIMIT 1`,
    args: [actionType, targetId, cutoff],
  });
  return res.rows.length > 0;
}

export async function listRecentRuns(limit = 30): Promise<MaintenanceRunRow[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM maintenance_runs ORDER BY started_at DESC LIMIT ?`,
    args: [Math.min(Math.max(limit, 1), 200)],
  });
  return res.rows as unknown as MaintenanceRunRow[];
}

export async function listActionsForRun(runId: string): Promise<MaintenanceActionRow[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM maintenance_actions WHERE run_id = ? ORDER BY applied_at ASC`,
    args: [runId],
  });
  return res.rows as unknown as MaintenanceActionRow[];
}

/** Сколько раз для item-id уже делался retry_enrichment с result='ok'. */
export async function countSuccessfulRetries(itemId: string): Promise<number> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM maintenance_actions
          WHERE action_type = 'retry_enrichment' AND target_id = ? AND result = 'ok'`,
    args: [itemId],
  });
  return Number((res.rows[0] as unknown as { n: number })?.n ?? 0);
}
