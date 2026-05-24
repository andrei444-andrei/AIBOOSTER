import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { checkAdminToken } from "@/lib/auth";
import { logServerError } from "@/lib/logger";
import {
  buildGoogleAuthUrl,
  DEFAULT_GOOGLE_SCOPES,
  getGoogleOAuthConfig,
} from "@/lib/oauth/google";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/oauth/google/start?token=<ADMIN_TOKEN>&source_id=<id>&kind=<gmail|gcal>
//
// Возвращает 302 на consent-страницу Google. state кодирует source_id+kind,
// чтобы callback знал, куда писать creds. Подписан HMAC'ом из ADMIN_TOKEN,
// чтобы посторонний не мог подделать state.
export async function GET(req: Request) {
  const auth = checkAdminToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const url = new URL(req.url);
  const sourceId = url.searchParams.get("source_id");
  const kind = url.searchParams.get("kind");
  if (!sourceId) {
    return NextResponse.json({ error: "source_id is required" }, { status: 400 });
  }
  if (kind !== "gmail" && kind !== "gcal") {
    return NextResponse.json(
      { error: "kind must be 'gmail' or 'gcal'" },
      { status: 400 },
    );
  }

  const cfg = getGoogleOAuthConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        error:
          "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI must be configured",
      },
      { status: 503 },
    );
  }

  try {
    const nonce = randomBytes(16).toString("hex");
    const payload = JSON.stringify({ source_id: sourceId, kind, nonce });
    const state = Buffer.from(payload).toString("base64url");

    const authUrl = buildGoogleAuthUrl({
      config: cfg,
      scopes: DEFAULT_GOOGLE_SCOPES,
      state,
    });
    return NextResponse.redirect(authUrl);
  } catch (err) {
    const error_id = await logServerError(err, "/api/oauth/google/start", {
      sourceId,
      kind,
    });
    return NextResponse.json({ error: "start failed", error_id }, { status: 500 });
  }
}
