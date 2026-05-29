import { NextResponse } from "next/server";
import { logServerError } from "@/lib/logger";
import { getActiveProfile, listSources, createSource, type SourceKind } from "@/lib/news";
import { suggestSourcesForProfile, lastSuggestDiag } from "@/lib/source-suggest";
import { discoverFeed } from "@/lib/feed-discover";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Sonar для подбора (~10-20s) + до 20 параллельных discoverFeed (~15s).
export const maxDuration = 60;

// POST /api/news/sources/auto-suggest
// Тело необязательное. Можно передать { per_topic: number, max_add: number }.
// Возвращает: { added: [...], skipped: [...] }.
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* пустое тело — OK */
  }
  const perTopic = clampInt(body.per_topic, 2, 1, 5);
  const maxAdd = clampInt(body.max_add, 30, 1, 60);

  try {
    const profile = await getActiveProfile();
    if ((profile.topics ?? []).filter((t) => (t.status ?? "active") === "active").length === 0) {
      return NextResponse.json(
        { error: "профиль пустой — добавь хотя бы 1 активную тему" },
        { status: 400 },
      );
    }

    const suggestions = await suggestSourcesForProfile(profile, perTopic);
    if (suggestions.length === 0) {
      return NextResponse.json({
        added: [],
        skipped: [],
        note: "Модель ничего не предложила — попробуй ещё раз через минуту",
        diag: lastSuggestDiag,
      });
    }

    // Дедуп по хосту (включая существующие источники).
    const existing = await listSources();
    const seenHosts = new Set<string>();
    for (const s of existing) {
      const h = safeHost(s.url);
      if (h) seenHosts.add(h);
    }

    const added: Array<{ url: string; name: string; kind: SourceKind; topic: string; why: string }> = [];
    const skipped: Array<{ url: string; reason: string; topic?: string; why?: string }> = [];

    // Параллельный discoverFeed (но не больше 8 в полёте — иначе Perplexity rate-limit'ит).
    const POOL = 8;
    let idx = 0;
    async function worker() {
      while (idx < suggestions.length && added.length < maxAdd) {
        const myIdx = idx++;
        const s = suggestions[myIdx];
        if (!s) return;
        const host = safeHost(s.url);
        if (!host) {
          skipped.push({ url: s.url, reason: "невалидный URL", topic: s.topic_name });
          continue;
        }
        if (seenHosts.has(host)) {
          skipped.push({ url: s.url, reason: "дубликат (уже есть из этого домена)", topic: s.topic_name });
          continue;
        }
        // Telegram-каналы можно добавить мгновенно — без HTTP-проверки.
        let kind: SourceKind;
        let resolvedUrl: string;
        if (s.kind_hint === "telegram" || /t\.me\//i.test(s.url)) {
          kind = "telegram";
          resolvedUrl = s.url;
        } else {
          try {
            const d = await discoverFeed(s.url);
            kind = d.kind;
            resolvedUrl = d.feed_url;
          } catch (err) {
            skipped.push({
              url: s.url,
              reason: `не открывается: ${err instanceof Error ? err.message.slice(0, 100) : "?"}`,
              topic: s.topic_name,
            });
            continue;
          }
        }
        try {
          const row = await createSource({
            kind,
            url: resolvedUrl,
            name: s.name,
            fetch_interval_minutes: 60,
          });
          seenHosts.add(host);
          added.push({ url: row.url, name: row.name, kind, topic: s.topic_name, why: s.why });
        } catch (err) {
          skipped.push({
            url: s.url,
            reason: `не вставилось: ${err instanceof Error ? err.message.slice(0, 80) : "?"}`,
            topic: s.topic_name,
          });
        }
      }
    }
    await Promise.all(Array.from({ length: POOL }, () => worker()));

    return NextResponse.json({
      added,
      skipped,
      considered: suggestions.length,
    });
  } catch (err) {
    const error_id = await logServerError(err, "/api/news/sources/auto-suggest");
    return NextResponse.json({ error: "failed", error_id }, { status: 500 });
  }
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : def;
  return Math.max(min, Math.min(max, n));
}

function safeHost(u: string): string | null {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
