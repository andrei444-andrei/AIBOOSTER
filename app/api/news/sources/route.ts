import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import {
  listSources,
  createSource,
  deleteSource,
  type SourceKind,
} from "@/lib/news";
import { discoverFeed } from "@/lib/feed-discover";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await listSources();
    return NextResponse.json({ count: rows.length, sources: rows });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/sources GET");
    return NextResponse.json({ error: "failed", error_id }, { status: 500 });
  }
}

// POST /api/news/sources { url, name?, fetch_interval_minutes? }
// Тип источника определяется автоматически:
//   - t.me/CHANNEL → telegram
//   - URL ведёт на RSS/Atom (через <link rel="alternate"> или /rss /feed /...) → rss
//   - Иначе → web (HTML-скрейп заголовков с главной).
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
  if (!rawUrl) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }
  const userName = typeof body.name === "string" ? body.name.trim() : "";
  const intervalRaw = typeof body.fetch_interval_minutes === "number" ? body.fetch_interval_minutes : 30;
  if (!Number.isFinite(intervalRaw) || intervalRaw < 5 || intervalRaw > 1440) {
    return NextResponse.json(
      { error: "fetch_interval_minutes must be between 5 and 1440" },
      { status: 400 },
    );
  }

  let kind: SourceKind;
  let resolvedUrl: string;
  let autoTitle: string | null = null;
  try {
    if (/t\.me\//i.test(rawUrl)) {
      kind = "telegram";
      resolvedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : "https://" + rawUrl;
    } else {
      const d = await discoverFeed(rawUrl);
      kind = d.kind;
      resolvedUrl = d.feed_url;
      autoTitle = d.title;
    }
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `не получилось разобрать ссылку: ${err.message}`
            : "не получилось разобрать ссылку",
      },
      { status: 400 },
    );
  }

  const finalName = (userName || autoTitle || deriveNameFromUrl(rawUrl)).slice(0, 200);

  try {
    const row = await createSource({
      kind,
      url: resolvedUrl,
      name: finalName,
      fetch_interval_minutes: Math.round(intervalRaw),
    });
    return NextResponse.json({ source: row, kind, resolved_url: resolvedUrl });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/sources POST");
    return NextResponse.json({ error: "failed", error_id }, { status: 500 });
  }
}

// DELETE /api/news/sources?id=...
export async function DELETE(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await deleteSource(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/sources DELETE");
    return NextResponse.json({ error: "failed", error_id }, { status: 500 });
  }
}

function deriveNameFromUrl(raw: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return raw.slice(0, 80);
  }
}
