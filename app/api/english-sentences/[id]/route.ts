import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { getTask, getItems, markItemCompleted, type Chunk } from "@/lib/english-sentences";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/english-sentences/[id] — задание + предложения (куски в правильном
// порядке; клиент сам перемешивает и проверяет сборку). Без auth — id это
// capability-токен (UUID).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const task = await getTask(id);
    if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
    const items = task.status === "ready" ? await getItems(id) : [];
    return NextResponse.json({
      task: {
        id: task.id,
        topic: task.topic,
        title: task.title,
        status: task.status,
        error_message: task.error_message,
        error_id: task.error_id,
        total: task.total,
        done: task.done,
        created_at: task.created_at,
      },
      items: items.map((it) => ({
        idx: it.idx,
        en: it.en_text,
        ru: it.ru_text,
        chunks: parseChunks(it.chunks),
        memo: it.memo,
        completed: it.completed,
      })),
    });
  } catch (err) {
    const error_id = await logServerError(err, `/api/english-sentences/${id}`);
    return NextResponse.json({ error: "не удалось прочитать задание", error_id }, { status: 500 });
  }
}

// PATCH /api/english-sentences/[id] — body { completed_idx: number }.
// Отмечает предложение собранным; задание авто-уезжает в «Сделано», когда
// собраны все. Возвращает { done, completed, total }.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  let body: { completed_idx?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const idx = Number(body.completed_idx);
  if (!Number.isInteger(idx) || idx < 0) {
    return NextResponse.json({ error: "completed_idx is required" }, { status: 400 });
  }

  try {
    const task = await getTask(id);
    if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
    const result = await markItemCompleted(id, idx);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const error_id = await logServerError(err, `/api/english-sentences/${id} PATCH`);
    return NextResponse.json({ error: "не удалось обновить задание", error_id }, { status: 500 });
  }
}

function parseChunks(raw: string): Chunk[] {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((c) => ({
        text: typeof c?.text === "string" ? c.text : "",
        tr: typeof c?.tr === "string" ? c.tr : "",
      }))
      .filter((c) => c.text);
  } catch {
    return [];
  }
}
