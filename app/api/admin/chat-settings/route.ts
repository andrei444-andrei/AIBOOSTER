import { NextResponse } from "next/server";
import { checkAdminToken } from "@/lib/auth";
import { DEFAULT_ENABLED_BLOCKS, getSettings, updateSettings, type EnabledBlocks } from "@/lib/chat";
import { logServerError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: { code: "auth", message: auth.reason } }, { status: auth.status });
  }
  try {
    const settings = await getSettings();
    return NextResponse.json({ settings });
  } catch (err) {
    const error_id = await logServerError(err, "/api/admin/chat-settings GET");
    return NextResponse.json(
      { error: { code: "load_failed", message: "failed to load settings", error_id } },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: { code: "auth", message: auth.reason } }, { status: auth.status });
  }
  let body: { system_prompt?: string; enabled_blocks?: Partial<EnabledBlocks> } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "bad_json", message: "invalid JSON" } }, { status: 400 });
  }

  const systemPrompt = typeof body.system_prompt === "string" ? body.system_prompt.slice(0, 8000) : "";
  const incoming = body.enabled_blocks ?? {};
  const enabled: EnabledBlocks = {
    headings: typeof incoming.headings === "boolean" ? incoming.headings : DEFAULT_ENABLED_BLOCKS.headings,
    emphasis: typeof incoming.emphasis === "boolean" ? incoming.emphasis : DEFAULT_ENABLED_BLOCKS.emphasis,
    lists: typeof incoming.lists === "boolean" ? incoming.lists : DEFAULT_ENABLED_BLOCKS.lists,
    tables: typeof incoming.tables === "boolean" ? incoming.tables : DEFAULT_ENABLED_BLOCKS.tables,
    code: typeof incoming.code === "boolean" ? incoming.code : DEFAULT_ENABLED_BLOCKS.code,
    quotes: typeof incoming.quotes === "boolean" ? incoming.quotes : DEFAULT_ENABLED_BLOCKS.quotes,
    hr: typeof incoming.hr === "boolean" ? incoming.hr : DEFAULT_ENABLED_BLOCKS.hr,
    links: typeof incoming.links === "boolean" ? incoming.links : DEFAULT_ENABLED_BLOCKS.links,
    images: typeof incoming.images === "boolean" ? incoming.images : DEFAULT_ENABLED_BLOCKS.images,
  };

  try {
    const settings = await updateSettings(systemPrompt, enabled);
    return NextResponse.json({ settings });
  } catch (err) {
    const error_id = await logServerError(err, "/api/admin/chat-settings POST");
    return NextResponse.json(
      { error: { code: "save_failed", message: "failed to save settings", error_id } },
      { status: 500 },
    );
  }
}
