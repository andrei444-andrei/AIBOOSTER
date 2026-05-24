import { NextResponse } from "next/server";
import { checkAdminToken } from "@/lib/auth";
import { getDb, ensureSchema } from "@/lib/db";
import type { AppErrorRow } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/errors?limit=N&token=...
// Фиксированная точка чтения логов (CONSTITUTION §2.2). Защищена токеном,
// но остаётся простым GET — чтобы агент/код могли достать ошибки прода одним
// запросом.
export async function GET(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const url = new URL(req.url);
  const limit = clampLimit(url.searchParams.get("limit"));
  const source = url.searchParams.get("source"); // optional: server|client
  const level = url.searchParams.get("level"); // optional

  try {
    await ensureSchema();
    const db = getDb();

    const where: string[] = [];
    const args: (string | number)[] = [];
    if (source === "server" || source === "client") {
      where.push("source = ?");
      args.push(source);
    }
    if (level) {
      where.push("level = ?");
      args.push(level);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    args.push(limit);

    const result = await db.execute({
      sql: `SELECT id, ts, level, source, route, message, stack, build, user_agent, meta
            FROM app_errors
            ${whereSql}
            ORDER BY ts DESC, rowid DESC
            LIMIT ?`,
      args,
    });

    const rows = result.rows as unknown as AppErrorRow[];
    return NextResponse.json({ count: rows.length, limit, errors: rows });
  } catch (err) {
    return NextResponse.json(
      {
        error: "failed to read app_errors",
        cause: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

function clampLimit(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(n, 1000);
}
