import { NextResponse } from "next/server";
import { checkAdminToken } from "@/lib/auth";
import { logServerError } from "@/lib/logger";
import { getActiveProfile, getStats } from "@/lib/news";
import { buildValidatorPrompt } from "@/lib/news-prompt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/news/prompt
// Возвращает текущий профиль + собранный промт-шаблон для отладки.
// Полезно перед смены формулировок промта — видишь ровно то, что улетит в LLM.
export async function GET(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  try {
    const profile = await getActiveProfile();
    const sample = buildValidatorPrompt(profile, {
      title: "Пример заголовка",
      body: "Пример тела поста для отладочной превьюшки.",
      source_name: "Пример источника",
      source_kind: "telegram",
      published_at: new Date().toISOString(),
    });
    const stats = await getStats();
    return NextResponse.json({
      profile,
      sample_prompt: sample,
      stats,
      model: "claude-sonnet-4-6",
    });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/prompt");
    return NextResponse.json({ error: "failed", error_id }, { status: 500 });
  }
}
