import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import {
  createUserReport,
  listUserReports,
  type ReportStatus,
} from "@/lib/news";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/news/reports — создать репорт
// body: { item_id, enrichment_id?, text }
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      item_id?: unknown;
      enrichment_id?: unknown;
      text?: unknown;
    };
    if (typeof body.item_id !== "string" || !body.item_id) {
      return NextResponse.json({ error: "item_id required" }, { status: 400 });
    }
    if (typeof body.text !== "string" || !body.text.trim()) {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }
    const enrichment_id =
      typeof body.enrichment_id === "string" && body.enrichment_id ? body.enrichment_id : null;
    const row = await createUserReport({
      item_id: body.item_id,
      enrichment_id,
      text: body.text,
    });
    return NextResponse.json({ ok: true, report: row });
  } catch (err) {
    const error_id = await logServerError(err, "POST /api/news/reports");
    return NextResponse.json({ error: "failed to create report", error_id }, { status: 500 });
  }
}

// GET /api/news/reports?status=open|reviewing|resolved|wontfix|all&limit=N
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const statusRaw = url.searchParams.get("status") ?? "all";
    const ALLOWED = new Set(["open", "reviewing", "resolved", "wontfix", "all"]);
    if (!ALLOWED.has(statusRaw)) {
      return NextResponse.json({ error: `invalid status: ${statusRaw}` }, { status: 400 });
    }
    const limit = parseLimit(url.searchParams.get("limit"), 100);
    const reports = await listUserReports({
      status: statusRaw as ReportStatus | "all",
      limit,
    });
    return NextResponse.json({ count: reports.length, reports });
  } catch (err) {
    const error_id = await logServerError(err, "GET /api/news/reports");
    return NextResponse.json({ error: "failed to list reports", error_id }, { status: 500 });
  }
}

function parseLimit(raw: string | null, def: number): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, 500);
}
