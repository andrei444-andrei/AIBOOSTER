import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { listRecentJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/jobs?limit=N
// Список недавних job'ов перевода — для боковой панели истории.
// Открыт без auth: id job'а это и так публично-известная capability,
// а в ответе нет никаких чувствительных полей.
export async function GET(req: Request) {
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? "30");
  try {
    const jobs = await listRecentJobs(Number.isFinite(limit) ? limit : 30);
    return NextResponse.json({ jobs });
  } catch (err) {
    const error_id = await logServerError(err, "/api/jobs");
    return NextResponse.json(
      { error: "не удалось прочитать список", error_id },
      { status: 500 },
    );
  }
}
