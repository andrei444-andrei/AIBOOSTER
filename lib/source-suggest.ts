// Подбор источников новостей под профиль пользователя.
//
// Идея: пользователь не хочет вручную искать RSS/каналы — мы скармливаем
// темы профиля в Perplexity sonar и просим вернуть авторитетные источники
// по каждой теме. Затем прогоняем через discoverFeed (наш существующий
// механизм: RSS-discover → web-scrape), дедуп по хосту, и добавляем.

import { chatJson, extractJsonObject } from "./aimlapi";
import type { InterestProfile, InterestTopic } from "./news-prompt";
import { ensureEnglish } from "./translate-en";

export interface SourceSuggestion {
  topic_name: string;
  name: string;
  url: string;
  kind_hint: "telegram" | "rss" | "web" | "unknown";
  why: string;
}

// Глобальная диагностика последнего вызова — для отладочного endpoint'а.
export let lastSuggestDiag: { error?: string; rawText?: string; rawLen?: number } = {};

// Claude Sonnet надёжнее в JSON-mode чем Sonar. Знает большинство
// устоявшихся отраслевых источников (это OK — для базовых рекомендаций
// нам не нужен realtime web-search).
const SUGGEST_MODEL = "claude-sonnet-4-6";

// Один запрос на ВЕСЬ профиль. Возвращает JSON-массив с 2-4 источниками
// на тему. Если что-то не парсится — soft-fail, возвращаем пусто.
// existingHosts — уже добавленные домены, чтобы модель не предлагала их повторно.
export async function suggestSourcesForProfile(
  profile: InterestProfile,
  perTopic = 3,
  existingHosts: string[] = [],
): Promise<SourceSuggestion[]> {
  const active = (profile.topics ?? []).filter((t): t is InterestTopic => (t.status ?? "active") === "active");
  if (active.length === 0) return [];

  const topicsBlock = active
    .slice(0, 30)
    .map((t, i) => {
      const d = t.description ? ` — ${t.description}` : "";
      return `${i + 1}. ${t.name}${d}`;
    })
    .join("\n");

  // Шлём темы на исходном языке — Sonnet многоязычен и Russian/English
  // источники не путает.
  const englishTopics = topicsBlock;
  void ensureEnglish; // оставлен импортом на случай возврата к Sonar

  const system =
    `You are a news-feed curator. For a personal reader with the topics below, suggest authoritative ` +
    `recurring news sources — primary outlets, expert blogs, Telegram channels, RSS feeds, ` +
    `Substacks. Mix popular and niche/underground sources. Avoid aggregators (Hacker News-style) ` +
    `UNLESS they're the standard for that field. Avoid dead, paywalled-only, or low-signal sites.\n\n` +
    `IMPORTANT: ` +
    `(1) If user listed any "existing domains" — DO NOT suggest those hosts again, pick alternatives.\n` +
    `(2) Don't suggest only the obvious top-3 outlets — include lesser-known but high-signal ` +
    `experts (specific authors' Substack, Twitter list curators, niche Telegram channels).\n` +
    `(3) Mix English and Russian where appropriate; for tech/AI English dominates, for Russian ` +
    `startup market — Russian sources are valuable.\n\n` +
    `Return STRICT JSON (no markdown, no preamble):\n` +
    `{ "suggestions": [\n` +
    `  { "topic_name": string,        // ровно одно из имён тем ниже\n` +
    `    "name": string,              // короткое имя источника для UI\n` +
    `    "url": string,               // прямая ссылка (https://t.me/CHANNEL, https://blog.../feed, https://site.com)\n` +
    `    "kind_hint": "telegram" | "rss" | "web",\n` +
    `    "why": string                // 1 короткая фраза почему\n` +
    `  }\n` +
    `]}`;

  const existingBlock = existingHosts.length > 0
    ? `\n\nEXISTING DOMAINS (don't repeat — already in user's feed):\n${existingHosts.slice(0, 100).join(", ")}\n`
    : "";

  const user = `TOPICS:\n${englishTopics}${existingBlock}\n\nSuggest ${perTopic} sources per topic. Output JSON only.`;

  try {
    const { parsed, rawText } = await chatJson<{ suggestions?: unknown }>({
      model: SUGGEST_MODEL,
      system,
      user,
      temperature: 0.3,
      timeoutMs: 45_000,
      maxTokens: 8000,
    });
    const out = normalizeSuggestions(parsed, active);
    lastSuggestDiag = { rawText: rawText.slice(0, 2000), rawLen: rawText.length };
    if (out.length === 0) {
      console.log(
        `[source-suggest] empty result. rawText len=${rawText.length}. preview: ${rawText.slice(0, 800)}`,
      );
    }
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lastSuggestDiag = { error: msg.slice(0, 2000) };
    console.log(`[source-suggest] error (model=${SUGGEST_MODEL}): ${msg.slice(0, 1000)}`);
    return [];
  }
}

function normalizeSuggestions(raw: unknown, topics: InterestTopic[]): SourceSuggestion[] {
  // Модели возвращают по-разному: чистый массив, { suggestions }, { sources },
  // { results }, { items } — поддерживаем все варианты.
  let arr: unknown = raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    for (const key of ["suggestions", "sources", "results", "items", "data"]) {
      if (Array.isArray(r[key])) {
        arr = r[key];
        break;
      }
    }
  } else if (typeof raw === "string") {
    arr = extractJsonObject(raw);
  }
  if (!Array.isArray(arr)) return [];

  const validTopicNames = new Set(topics.map((t) => t.name));
  const out: SourceSuggestion[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const url = typeof r.url === "string" ? r.url.trim() : "";
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!url || !name) continue;
    if (!/^https?:\/\//i.test(url) && !/^t\.me\//i.test(url) && !/^@\w/.test(url)) continue;
    const topicName = typeof r.topic_name === "string" ? r.topic_name.trim() : "";
    // Принимаем только source'ы, тема которых из нашего списка (sonar иногда
    // придумывает свои названия — стараемся matchнуть, иначе берём первую).
    const matchedTopic = validTopicNames.has(topicName) ? topicName : topics[0]?.name ?? "—";
    const kindRaw = typeof r.kind_hint === "string" ? r.kind_hint.toLowerCase() : "";
    const kind_hint: SourceSuggestion["kind_hint"] =
      kindRaw === "telegram" || kindRaw === "rss" || kindRaw === "web" ? kindRaw : "unknown";
    out.push({
      topic_name: matchedTopic,
      name: name.slice(0, 200),
      url: normalizeUrl(url),
      kind_hint,
      why: typeof r.why === "string" ? r.why.slice(0, 300) : "",
    });
  }
  return out;
}

function normalizeUrl(raw: string): string {
  let s = raw.trim();
  // Конвертация @channel и t.me/channel в полный URL.
  if (/^@[\w-]+$/.test(s)) return `https://t.me/${s.slice(1)}`;
  if (/^t\.me\//i.test(s)) return `https://${s}`;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s.replace(/\/+$/, "");
}
