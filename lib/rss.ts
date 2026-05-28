// Парсер RSS 2.0 и Atom. Без внешних зависимостей: пишем минималистичный
// regex-парсер, потому что для нашей задачи (заголовок + тело + дата + url +
// guid) полноценная XML-библиотека избыточна и тащит лишний bundle-size на
// serverless.
//
// Поддерживаем оба формата (RSS 2.0 и Atom 1.0) — выбираются автоматически
// по корневому тегу. Возвращаем не более N последних элементов; для
// бесконечно длинных лент это режется на верхнем уровне.

export interface NormalizedRssItem {
  external_id: string;
  url: string;
  title: string | null;
  body: string;
  published_at: string | null;
  raw_meta: Record<string, unknown>;
}

const MAX_RSS_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const RSS_FETCH_TIMEOUT_MS = 15_000;

export async function fetchRss(
  url: string,
  limit = 20,
): Promise<NormalizedRssItem[]> {
  assertPublicHttpUrl(url);

  // Ручной редирект, чтобы каждый hop пропустить через assertPublicHttpUrl
  // (защита от 302 на внутренние адреса). AbortController на каждый hop
  // отдельно — общий бюджет ~MAX_REDIRECTS * RSS_FETCH_TIMEOUT_MS.
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RSS_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "AIBOOSTER-news/0.1 (+https://aibooster.app)",
          accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
        },
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`rss fetch timeout after ${RSS_FETCH_TIMEOUT_MS}ms for ${current}`);
      }
      throw err;
    }
    clearTimeout(timer);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`rss redirect without Location for ${current}`);
      const next = new URL(loc, current).toString();
      assertPublicHttpUrl(next);
      current = next;
      continue;
    }
    if (!res.ok) {
      throw new Error(`rss fetch ${res.status} for ${current}`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_RSS_BYTES) {
      throw new Error(`rss too large: ${buf.byteLength} bytes (cap ${MAX_RSS_BYTES})`);
    }
    const xml = new TextDecoder("utf-8").decode(buf);
    return parseRss(xml, limit);
  }
  throw new Error(`rss too many redirects from ${url}`);
}

// SSRF-защита: запрещаем не-http/https и любые приватные/loopback/link-local
// адреса в host (числовые литералы). DNS-резолв здесь не делаем, чтобы не
// тащить node:dns в edge-вариант бандла — для большинства атак (179.254...,
// 10..., 127..., localhost) этого достаточно. Полная защита — на сетевом
// уровне (Vercel egress).
export function assertPublicHttpUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`invalid URL: ${raw.slice(0, 200)}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`only http(s) allowed, got ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    throw new Error(`host not allowed: ${host}`);
  }
  // IPv4 literal: проверяем октеты.
  const m4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m4) {
    const a = m4.slice(1).map((x) => parseInt(x, 10));
    if (a.some((x) => Number.isNaN(x) || x < 0 || x > 255)) {
      throw new Error(`invalid IPv4: ${host}`);
    }
    const [b1, b2] = a;
    if (
      b1 === 10 ||
      b1 === 127 ||
      b1 === 0 ||
      (b1 === 169 && b2 === 254) ||
      (b1 === 172 && b2 >= 16 && b2 <= 31) ||
      (b1 === 192 && b2 === 168) ||
      b1 >= 224 // multicast/reserved
    ) {
      throw new Error(`private/reserved IPv4 not allowed: ${host}`);
    }
  }
  // IPv6 literal (URL.hostname возвращает в квадратных скобках убран).
  if (host.includes(":")) {
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
      throw new Error(`private/reserved IPv6 not allowed: ${host}`);
    }
  }
}

export function parseRss(xml: string, limit = 20): NormalizedRssItem[] {
  // Сначала пробуем как RSS 2.0 (<item>...</item>), затем как Atom (<entry>).
  const isAtom = /<feed[\s>][\s\S]*<entry[\s>]/i.test(xml);
  const itemTag = isAtom ? "entry" : "item";
  const blocks = extractBlocks(xml, itemTag);

  const out: NormalizedRssItem[] = [];
  for (const block of blocks) {
    const item = isAtom ? parseAtomEntry(block) : parseRssItem(block);
    if (item) out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function parseRssItem(block: string): NormalizedRssItem | null {
  const guid = textOf(block, "guid") ?? "";
  // RSS 2.0 — обычный <link>https://...</link>. Иногда в смешанных лентах
  // встречается atom-style <link href="..." rel="alternate"/>.
  let link = textOf(block, "link") ?? "";
  if (!link.trim()) {
    const m = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    if (m) link = m[1];
  }
  const externalId = (guid || link || "").trim();
  if (!externalId) return null;

  const title = textOf(block, "title");
  // description часто содержит HTML — оставляем как есть, валидатор
  // справится; для UI снимем теги в pipeline.
  const description = textOf(block, "description") ?? "";
  const contentEncoded = textOf(block, "content:encoded") ?? "";
  const body = (contentEncoded || description).trim();
  const pubDate = textOf(block, "pubDate") ?? textOf(block, "dc:date");
  const publishedAt = normalizeDate(pubDate);

  return {
    external_id: externalId,
    url: link.trim(),
    title: title?.trim() || null,
    body,
    published_at: publishedAt,
    raw_meta: { guid, link, pubDate, raw: block.slice(0, 1000) },
  };
}

function parseAtomEntry(block: string): NormalizedRssItem | null {
  const id = textOf(block, "id") ?? "";
  // Atom: <link href="..."/>
  const linkMatch = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  const link = linkMatch?.[1] ?? "";
  const externalId = (id || link).trim();
  if (!externalId) return null;

  const title = textOf(block, "title");
  const content = textOf(block, "content") ?? textOf(block, "summary") ?? "";
  const updated = textOf(block, "updated") ?? textOf(block, "published");
  const publishedAt = normalizeDate(updated);

  return {
    external_id: externalId,
    url: link.trim(),
    title: title?.trim() || null,
    body: content.trim(),
    published_at: publishedAt,
    raw_meta: { id, link, updated, raw: block.slice(0, 1000) },
  };
}

function extractBlocks(xml: string, tag: string): string[] {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const close = new RegExp(`</${tag}\\s*>`, "i");
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml))) {
    const start = m.index + m[0].length;
    const rest = xml.slice(start);
    const c = rest.match(close);
    if (!c || c.index === undefined) break;
    blocks.push(rest.slice(0, c.index));
    open.lastIndex = start + c.index + c[0].length;
  }
  return blocks;
}

// Берём текстовое содержимое тега <tag>...</tag> (первое вхождение).
// Поддерживаем CDATA и снимаем basic-сущности. CDATA может встречаться
// частично (не оборачивать весь текст), поэтому глобальная замена.
function textOf(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "i");
  const m = block.match(re);
  if (!m) return null;
  let v = m[1] ?? "";
  v = v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return decodeEntities(v);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&amp;/g, "&");
}

function normalizeDate(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

// Утилита: грубое снятие HTML-тегов для отображения в UI / отправки
// валидатору. Сохраняем переводы строк там, где были </p> и <br>.
// Сначала вырезаем содержимое опасных тегов целиком (script/style/iframe и
// т.п.) — иначе их тело попадёт в текст и в промт валидатора как мусор.
export function stripHtml(s: string): string {
  return s
    .replace(/<(script|style|iframe|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/(p|div|li|h\d|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
