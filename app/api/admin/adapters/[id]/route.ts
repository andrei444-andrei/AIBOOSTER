import { NextResponse } from "next/server";
import { checkAdminToken } from "@/lib/auth";
import { logServerError } from "@/lib/logger";
import { getDb, ensureSchema } from "@/lib/db";
import { getSource, setSourceStatus, scheduleNextRun } from "@/lib/adapters/sources";
import { enqueueJob } from "@/lib/adapters/sync-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/admin/adapters/<id>
// Body (любая комбинация):
//   { action: 'enable' | 'disable' | 'sync_now' | 'reset_cursor' }
//
// Управляющие операции над одним источником.
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";

  try {
    const src = await getSource(id);
    if (!src) return NextResponse.json({ error: "source not found" }, { status: 404 });

    switch (action) {
      case "enable":
        await setSourceStatus(id, "idle");
        return NextResponse.json({ ok: true });
      case "disable":
        await setSourceStatus(id, "disabled");
        return NextResponse.json({ ok: true });
      case "sync_now": {
        // Сбрасываем next_run_at, чтобы tick подхватил источник немедленно,
        // и сразу ставим job в очередь — не ждём cron.
        await ensureSchema();
        const db = getDb();
        await db.execute({
          sql: `UPDATE adapter_sources SET next_run_at = NULL, status = 'idle', updated_at = ? WHERE id = ?`,
          args: [new Date().toISOString(), id],
        });
        const job = await enqueueJob({ sourceId: id, kind: src.kind, jobKind: "pull" });
        return NextResponse.json({ ok: true, job_id: job.id });
      }
      case "reset_cursor": {
        // Сбрасываем cursor — следующий sync пойдёт с нуля (полный refetch).
        // Может быть дорого для крупных источников — используй осознанно.
        await scheduleNextRun({ id, cursor: null });
        await setSourceStatus(id, "idle");
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json(
          { error: "action must be one of: enable, disable, sync_now, reset_cursor" },
          { status: 400 },
        );
    }
  } catch (err) {
    const error_id = await logServerError(err, "/api/admin/adapters/[id]", { id, action });
    return NextResponse.json({ error: "patch failed", error_id }, { status: 500 });
  }
}

// DELETE /api/admin/adapters/<id>
// Удаляет источник (но не данные в per-source таблицах и не context_snippets —
// они остаются в БД, чтобы не терять контекст случайно).
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await ctx.params;
  try {
    await ensureSchema();
    const db = getDb();
    await db.execute({
      sql: `DELETE FROM adapter_sources WHERE id = ?`,
      args: [id],
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const error_id = await logServerError(err, "/api/admin/adapters/[id]", { id });
    return NextResponse.json({ error: "delete failed", error_id }, { status: 500 });
  }
}
