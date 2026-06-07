import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { createTask, generateTaskContent, listTasks } from "@/lib/english-sentences";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120; // один вызов LLM на 10 предложений

// GET /api/english-sentences?section=todo|done|all — список заданий.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const s = url.searchParams.get("section");
  const section = s === "todo" || s === "done" ? s : "all";
  try {
    const tasks = await listTasks(section);
    return NextResponse.json({ tasks });
  } catch (err) {
    const error_id = await logServerError(err, "/api/english-sentences");
    return NextResponse.json({ error: "не удалось прочитать список", error_id }, { status: 500 });
  }
}

// POST /api/english-sentences — body { topic }. Создаёт задание и синхронно
// генерит 10 предложений (один вызов LLM, ~15-25с). Возвращает { task_id }.
// generateTaskContent сам ловит ошибки и помечает задачу failed, поэтому
// POST не падает из-за сбоя генерации — статус виден на странице задания.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) return NextResponse.json({ error: "укажи тему" }, { status: 400 });
  if (topic.length > 2000) {
    return NextResponse.json({ error: "тема слишком длинная (макс 2000 символов)" }, { status: 400 });
  }

  try {
    const task = await createTask(topic);
    await generateTaskContent(task.id, topic);
    return NextResponse.json({ task_id: task.id });
  } catch (err) {
    const error_id = await logServerError(err, "/api/english-sentences", { topic });
    return NextResponse.json({ error: "не удалось создать задание", error_id }, { status: 500 });
  }
}
