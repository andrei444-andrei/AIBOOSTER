import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { listRecentJobs, type WatchStatus } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/jobs?limit=N&watch=to_watch|watched|all
// Список недавних job'ов перевода — для библиотеки и боковой панели истории.
// Открыт без auth: id job'а это и так публично-известная capability,
// а в ответе нет никаких чувствительных полей.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "60");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 60;
  const watchRaw = url.searchParams.get("watch") ?? "all";
  const watchStatus: WatchStatus | "all" =
    watchRaw === "to_watch" || watchRaw === "watched" ? watchRaw : "all";

  try {
    const jobs = await listRecentJobs({ limit, watchStatus });
    return NextResponse.json({ jobs });
  } catch (err) {
    const error_id = await logServerError(err, "/api/jobs");
    return NextResponse.json(
      { error: "не удалось прочитать список", error_id },
      { status: 500 },
    );
  }
}
