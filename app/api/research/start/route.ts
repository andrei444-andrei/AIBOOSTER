import { checkAdminToken } from "@/lib/auth";
import { startRun } from "@/lib/research/engine";
import { logServerError } from "@/lib/logger";
import type { ResearchParams } from "@/lib/research/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/research/start  { goal: string, params?: Partial<ResearchParams> }
// Создаёт прогон (status=running) и его корневой узел. Дальше прогон двигают
// cron (/api/research/cron) или ручной тик (/api/research/tick). Под admin-токеном.
export async function POST(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status });
  }

  let body: { goal?: unknown; params?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (!goal) {
    return Response.json({ error: "field 'goal' is required" }, { status: 400 });
  }

  try {
    const override = pickParams(body.params);
    const id = await startRun(goal, override);
    return Response.json({ id }, { status: 201 });
  } catch (err) {
    const errorId = await logServerError(err, "/api/research/start", { goal });
    return Response.json(
      { error: "failed to start run", error_id: errorId },
      { status: 500 },
    );
  }
}

// Безопасно вытаскивает только разрешённые числовые переопределения параметров.
function pickParams(raw: unknown): Partial<ResearchParams> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const out: Partial<ResearchParams> = {};
  const num = (k: keyof ResearchParams) => {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      (out[k] as number) = v;
    }
  };
  num("maxDepth");
  num("fanout");
  num("maxNodes");
  num("maxCostUsd");
  num("searchResults");
  return Object.keys(out).length ? out : undefined;
}
