import { NextResponse } from "next/server";
import { checkAdminToken } from "@/lib/auth";
import { logServerError } from "@/lib/logger";
import { listSources, upsertSource } from "@/lib/adapters/sources";
import type { AdapterKind } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_KINDS: AdapterKind[] = ["gmail", "notion", "slack", "telegram", "gcal"];

// GET /api/admin/adapters
// Возвращает список источников. credentials наружу не отдаём — только факт
// наличия.
export async function GET(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  try {
    const sources = await listSources();
    return NextResponse.json({
      sources: sources.map((s) => ({
        id: s.id,
        kind: s.kind,
        display_name: s.display_name,
        status: s.status,
        interval_sec: s.interval_sec,
        has_credentials: !!s.credentials,
        last_run_at: s.last_run_at,
        next_run_at: s.next_run_at,
        last_error: s.last_error,
        last_error_id: s.last_error_id,
        created_at: s.created_at,
        updated_at: s.updated_at,
      })),
    });
  } catch (err) {
    const error_id = await logServerError(err, "/api/admin/adapters");
    return NextResponse.json({ error: "list failed", error_id }, { status: 500 });
  }
}

// POST /api/admin/adapters
// Body: { id, kind, display_name?, credentials?, interval_sec? }
//
// Создаёт/обновляет источник. credentials — произвольный JSON, специфичный
// для адаптера (адаптер сам парсит его в свой Creds-тип).
export async function POST(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const kind = typeof body.kind === "string" ? (body.kind as AdapterKind) : null;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (!kind || !VALID_KINDS.includes(kind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${VALID_KINDS.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const row = await upsertSource({
      id,
      kind,
      displayName:
        body.display_name === null
          ? null
          : typeof body.display_name === "string"
            ? body.display_name
            : undefined,
      credentials: body.credentials,
      intervalSec:
        typeof body.interval_sec === "number" ? body.interval_sec : undefined,
    });
    return NextResponse.json({
      ok: true,
      source: {
        id: row.id,
        kind: row.kind,
        display_name: row.display_name,
        status: row.status,
        interval_sec: row.interval_sec,
        has_credentials: !!row.credentials,
        last_run_at: row.last_run_at,
        next_run_at: row.next_run_at,
      },
    });
  } catch (err) {
    const error_id = await logServerError(err, "/api/admin/adapters", { id, kind });
    return NextResponse.json({ error: "upsert failed", error_id }, { status: 500 });
  }
}
