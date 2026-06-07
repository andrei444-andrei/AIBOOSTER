import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { logServerError } from "@/lib/logger";
import {
  createDialogueJob,
  listDialogueJobs,
  type DialogueKind,
  type WatchStatus,
} from "@/lib/english-dialogues";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/english-dialogues?limit=N&watch=to_watch|watched|all
// Список сгенерированных разговоров для библиотеки. Открыт без auth — id это
// публичная capability, чувствительных полей в ответе нет.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "60");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 60;
  const watchRaw = url.searchParams.get("watch") ?? "all";
  const watchStatus: WatchStatus | "all" =
    watchRaw === "to_watch" || watchRaw === "watched" ? watchRaw : "all";

  try {
    const jobs = await listDialogueJobs({ limit, watchStatus });
    return NextResponse.json({ jobs });
  } catch (err) {
    const error_id = await logServerError(err, "/api/english-dialogues");
    return NextResponse.json(
      { error: "не удалось прочитать список", error_id },
      { status: 500 },
    );
  }
}

// POST /api/english-dialogues
// Body: { topic, duration_min, kind: 'dialogue'|'monologue', with_translation }
// Создаёт задачу (queued) и в фоне дёргает воркер, чтобы не ждать тика cron.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) {
    return NextResponse.json({ error: "укажи тему разговора" }, { status: 400 });
  }
  if (topic.length > 2000) {
    return NextResponse.json({ error: "тема слишком длинная (макс 2000 символов)" }, { status: 400 });
  }

  const durationMin = clampDuration(body.duration_min);
  const kind: DialogueKind = body.kind === "monologue" ? "monologue" : "dialogue";
  const withTranslation = body.with_translation === true || body.with_translation === 1;
  const speed = clampSpeed(body.speed);

  try {
    const job = await createDialogueJob({ topic, durationMin, kind, withTranslation, speed });
    waitUntil(triggerProcessing(req));
    return NextResponse.json({ job_id: job.id });
  } catch (err) {
    const error_id = await logServerError(err, "/api/english-dialogues", {
      topic,
      durationMin,
      kind,
      withTranslation,
      speed,
    });
    return NextResponse.json(
      { error: "не удалось создать задачу", error_id },
      { status: 500 },
    );
  }
}

function clampDuration(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 3;
  return Math.max(3, Math.min(10, n));
}

// Темп озвучки, запекаемый при генерации. Шаг 0.05, диапазон 0.7..1.2,
// дефолт 0.9 (натуральный ElevenLabs ~1.0 слишком быстрый для учащихся).
function clampSpeed(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.9;
  return Math.max(0.7, Math.min(1.2, Math.round(n * 20) / 20));
}

// Дёргает воркер на этом же деплое, чтобы он сразу забрал свежую задачу
// (как в /api/translate-video). waitUntil держит инвокацию после ответа.
async function triggerProcessing(req: Request): Promise<void> {
  const secret = process.env.CRON_SECRET || process.env.ADMIN_TOKEN || "";
  const origin = new URL(req.url).origin;
  try {
    await fetch(`${origin}/api/cron/process-english`, {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    });
  } catch (err) {
    console.error("[english-dialogues] background trigger failed:", err);
  }
}
