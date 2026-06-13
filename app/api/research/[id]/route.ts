import { checkAdminToken } from "@/lib/auth";
import { getRun, listNodes, listFindings } from "@/lib/research/store";
import { logServerError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/research/<id>  → { run, nodes, findings }
// Полный снимок прогона для визуализатора (дерево + реестр). Под admin-токеном.
// Клиент поллит этот эндпоинт, пока run.status === 'running', чтобы видеть прогресс live.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status });
  }

  const { id } = await params;
  try {
    const run = await getRun(id);
    if (!run) {
      return Response.json({ error: "run not found" }, { status: 404 });
    }
    const [nodes, findings] = await Promise.all([listNodes(id), listFindings(id)]);
    return Response.json({ run, nodes, findings });
  } catch (err) {
    const errorId = await logServerError(err, "/api/research/[id]", { id });
    return Response.json(
      { error: "failed to load run", error_id: errorId },
      { status: 500 },
    );
  }
}
