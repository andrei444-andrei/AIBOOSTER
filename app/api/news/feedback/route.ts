import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { recordFeedback, getItem } from "@/lib/news";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_REASONS = new Set([
  "точно по теме",
  "практично/применимо",
  "новый угол",
  "не моя тема",
  "поверхностно",
  "уже видел",
  "кликбейт",
]);

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const item_id = typeof body.item_id === "string" ? body.item_id : "";
  const signal = body.signal;
  if (!item_id) return NextResponse.json({ error: "item_id required" }, { status: 400 });
  if (signal !== "like" && signal !== "dislike" && signal !== "hide") {
    return NextResponse.json({ error: "signal must be like|dislike|hide" }, { status: 400 });
  }
  const reason_chip =
    typeof body.reason_chip === "string" && ALLOWED_REASONS.has(body.reason_chip)
      ? body.reason_chip
      : null;
  const custom_text =
    typeof body.custom_text === "string" ? body.custom_text.slice(0, 2000) : null;
  try {
    const item = await getItem(item_id);
    if (!item) return NextResponse.json({ error: "item not found" }, { status: 404 });
    await recordFeedback({ item_id, signal, reason_chip, custom_text });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/feedback", { item_id });
    return NextResponse.json({ error: "failed", error_id }, { status: 500 });
  }
}
