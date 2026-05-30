import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { updateUserReportStatus, type ReportStatus } from "@/lib/news";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/news/reports/:id
// body: { status: 'open'|'reviewing'|'resolved'|'wontfix', resolution?: string }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json()) as { status?: unknown; resolution?: unknown };
    const ALLOWED: ReportStatus[] = ["open", "reviewing", "resolved", "wontfix"];
    if (typeof body.status !== "string" || !ALLOWED.includes(body.status as ReportStatus)) {
      return NextResponse.json(
        { error: `status must be one of: ${ALLOWED.join(", ")}` },
        { status: 400 },
      );
    }
    const resolution =
      typeof body.resolution === "string" && body.resolution.trim()
        ? body.resolution.trim().slice(0, 5000)
        : null;
    await updateUserReportStatus(id, body.status as ReportStatus, resolution);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const error_id = await logServerError(err, `PATCH /api/news/reports/${id}`);
    return NextResponse.json({ error: "failed to update report", error_id }, { status: 500 });
  }
}
