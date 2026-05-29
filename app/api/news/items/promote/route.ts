import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { promoteItem, getItem } from "@/lib/news";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/news/items/promote { item_id } — skipped → show.
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const itemId = typeof body.item_id === "string" ? body.item_id : "";
  if (!itemId) {
    return NextResponse.json({ error: "item_id required" }, { status: 400 });
  }
  try {
    const item = await getItem(itemId);
    if (!item) return NextResponse.json({ error: "item not found" }, { status: 404 });
    await promoteItem(itemId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/items/promote", { itemId });
    return NextResponse.json({ error: "failed", error_id }, { status: 500 });
  }
}
