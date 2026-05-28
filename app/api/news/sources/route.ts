import { NextResponse } from "next/server";
import { checkAdminToken } from "@/lib/auth";
import { logServerError } from "@/lib/logger";
import {
  listSources,
  createSource,
  deleteSource,
  type SourceKind,
} from "@/lib/news";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/news/sources — список всех источников.
export async function GET(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  try {
    const rows = await listSources();
    return NextResponse.json({ count: rows.length, sources: rows });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/sources GET");
    return NextResponse.json({ error: "failed", error_id }, { status: 500 });
  }
}

// POST /api/news/sources { kind, url, name, fetch_interval_minutes? }
export async function POST(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const kind = body.kind;
  const url = body.url;
  const name = body.name;
  if (kind !== "telegram" && kind !== "rss") {
    return NextResponse.json({ error: "kind must be telegram|rss" }, { status: 400 });
  }
  if (typeof url !== "string" || !url.startsWith("http")) {
    return NextResponse.json({ error: "url must be a valid http(s) URL" }, { status: 400 });
  }
  if (kind === "telegram" && !/^https?:\/\/t\.me\//i.test(url)) {
    return NextResponse.json(
      { error: "telegram url must look like https://t.me/CHANNEL" },
      { status: 400 },
    );
  }
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const intervalRaw = typeof body.fetch_interval_minutes === "number" ? body.fetch_interval_minutes : 30;
  if (!Number.isFinite(intervalRaw) || intervalRaw < 5 || intervalRaw > 1440) {
    return NextResponse.json(
      { error: "fetch_interval_minutes must be between 5 and 1440" },
      { status: 400 },
    );
  }
  try {
    const row = await createSource({
      kind: kind as SourceKind,
      url,
      name: name.trim().slice(0, 200),
      fetch_interval_minutes: Math.round(intervalRaw),
    });
    return NextResponse.json({ source: row });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/sources POST");
    return NextResponse.json({ error: "failed", error_id }, { status: 500 });
  }
}

// DELETE /api/news/sources?id=...
export async function DELETE(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const u = new URL(req.url);
  const id = u.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await deleteSource(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/sources DELETE");
    return NextResponse.json({ error: "failed", error_id }, { status: 500 });
  }
}
