import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { upsertSource, getSource } from "@/lib/adapters/sources";
import {
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  getGoogleOAuthConfig,
} from "@/lib/oauth/google";
import type { AdapterKind } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/oauth/google/callback?code=...&state=...
//
// Колбэк Google после consent. Меняем code на токены, кладём refresh_token
// в credentials источника. Никаких ADMIN_TOKEN — Google сам гарантирует
// подлинность кода. state нужен только чтобы знать, в какой источник писать.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return html(`<h1>OAuth error</h1><p>Google вернул: <code>${escapeHtml(errorParam)}</code></p>`);
  }
  if (!code || !stateRaw) {
    return html(`<h1>OAuth callback: bad request</h1><p>code/state отсутствуют</p>`, 400);
  }

  let state: { source_id?: string; kind?: AdapterKind };
  try {
    state = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8"));
  } catch {
    return html(`<h1>OAuth callback: bad state</h1>`, 400);
  }
  const sourceId = state.source_id;
  const kind = state.kind;
  if (!sourceId || !kind) {
    return html(`<h1>OAuth callback: state без source_id/kind</h1>`, 400);
  }

  const cfg = getGoogleOAuthConfig();
  if (!cfg) {
    return html(`<h1>OAuth: GOOGLE_OAUTH_* не настроены</h1>`, 503);
  }

  try {
    const tokens = await exchangeGoogleCode({ config: cfg, code });

    // refresh_token Google отдаёт ТОЛЬКО при первом consent с prompt=consent.
    // Если повторный — возьмём существующий из creds.
    let refresh_token = tokens.refresh_token;
    if (!refresh_token) {
      const existing = await getSource(sourceId);
      if (existing?.credentials) {
        try {
          const prev = JSON.parse(existing.credentials);
          if (typeof prev.refresh_token === "string") {
            refresh_token = prev.refresh_token;
          }
        } catch {
          // игнор
        }
      }
    }

    let displayName: string | undefined;
    try {
      const info = await fetchGoogleUserInfo(tokens.access_token);
      displayName = info.email ?? info.name;
    } catch {
      // не критично — оставим прежнее display_name
    }

    const expiresAt =
      typeof tokens.expires_in === "number"
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null;

    await upsertSource({
      id: sourceId,
      kind,
      displayName: displayName ?? null,
      credentials: {
        refresh_token,
        access_token: tokens.access_token,
        access_token_expires_at: expiresAt,
        scope: tokens.scope,
      },
    });

    return html(`
      <h1>Google подключён</h1>
      <p>Источник <code>${escapeHtml(sourceId)}</code> (<code>${escapeHtml(kind)}</code>) сохранён.</p>
      ${displayName ? `<p>Аккаунт: <b>${escapeHtml(displayName)}</b></p>` : ""}
      <p>Можно закрыть вкладку и вернуться в <a href="/admin/adapters">/admin/adapters</a>.</p>
    `);
  } catch (err) {
    const error_id = await logServerError(err, "/api/oauth/google/callback", {
      sourceId,
      kind,
    });
    return html(
      `<h1>OAuth callback: ошибка</h1><p>error_id: <code>${escapeHtml(error_id)}</code></p>`,
      500,
    );
  }
}

function html(body: string, status = 200): Response {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>OAuth</title>
      <style>body{font-family:system-ui;max-width:640px;margin:60px auto;padding:0 20px;color:#e6e8eb;background:#0b0d10}
      code{background:#1a1e24;padding:1px 5px;border-radius:4px}
      a{color:#79b8ff}</style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
