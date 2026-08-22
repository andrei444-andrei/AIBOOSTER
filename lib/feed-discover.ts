// Из произвольной ссылки на сайт находим RSS-ленту: пользователь не должен
// искать /feed руками. Алгоритм:
//   1. Если URL уже похож на RSS/Atom — возвращаем его как есть.
//   2. Тянем HTML главной, ищем <link rel="alternate" type="application/rss+xml">.
//   3. Пробуем типовые пути: /rss, /feed, /rss.xml, /atom.xml, /feed.xml.
//   4. Не нашли → kind='web', будет HTML-скрейп заголовков (lib/web-scrape).

import { assertPublicHttpUrl } from "./rss";

const COMMON_FEED_PATHS = [
  "/rss",
  "/feed",
  "/rss.xml",
  "/feed.xml",
  "/atom.xml",
  "/index.xml",
  "/feeds/posts/default",
  "/rss/index.xml",
  "/feeds/all.atom.xml",
];

const FETCH_TIMEOUT_MS = 10_000;
const HTML_BYTES_CAP = 3 * 1024 * 1024;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export interface DiscoverResult {
  kind: "rss" | "web";
  feed_url: string;
  homepage_url: string;
  title: string | null;
}

export async function discoverFeed(input: string): Promise<DiscoverResult> {
  const url = normalizeHttpUrl(input);
  assertPublicHttpUrl(url);

  // 1. URL уже похож на RSS — поверим, потом валидатор lib/rss.ts всё равно
  //    проверит формат при первом fetch'е.
  if (/\.(rss|xml|atom)(\?|$)/i.test(url) || /\/rss\b|\/feed\b|\/atom\b/i.test(url)) {
    if (await looksLikeFeed(url)) {
      return { kind: "rss", feed_url: url, homepage_url: url, title: null };
    }
  }

  // 2. Тянем HTML, ищем <link rel="alternate" type="...rss/atom...">.
  const html = await tryFetchHtml(url);
  if (html) {
    const head = html.slice(0, 100_000);
    const linkFeed = findAlternateFeed(head, url);
    const title = pickTitle(head);
    if (linkFeed) {
      return { kind: "rss", feed_url: linkFeed, homepage_url: url, title };
    }
    // 3. Типовые пути.
    const u = new URL(url);
    for (const p of COMMON_FEED_PATHS) {
      const candidate = `${u.origin}${p}`;
      if (await looksLikeFeed(candidate)) {
        return { kind: "rss", feed_url: candidate, homepage_url: url, title };
      }
    }
    // 4. Не нашли RSS — web-скрейп.
    return { kind: "web", feed_url: url, homepage_url: url, title };
  }

  // Не дотянулись до HTML — оставим как web и пусть фетч позже сам разбирается.
  return { kind: "web", feed_url: url, homepage_url: url, title: null };
}

function normalizeHttpUrl(raw: string): string {
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  // Уберём trailing slash для главной — pretty.
  return s.replace(/\/+$/, "");
}

async function tryFetchHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": BROWSER_UA,
        accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > HTML_BYTES_CAP ? buf.slice(0, HTML_BYTES_CAP) : buf;
    return new TextDecoder("utf-8").decode(slice);
  } catch {
    return null;
  }
}

// Лёгкая проверка «похоже на feed»: HEAD/маленький GET и смотрим content-type
// либо первые байты. Без полного парсинга — это roundtrip-чек.
async function looksLikeFeed(url: string): Promise<boolean> {
  try {
    assertPublicHttpUrl(url);
  } catch {
    return false;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": BROWSER_UA,
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (/(rss|atom|xml)/.test(ct)) return true;
    // Иногда content-type врёт. Смотрим первые байты.
    const buf = await res.arrayBuffer();
    const head = new TextDecoder("utf-8").decode(buf.slice(0, 1024)).toLowerCase();
    return /<rss\b|<feed\b|<\?xml/.test(head) && /<item\b|<entry\b/.test(
      new TextDecoder("utf-8").decode(buf.slice(0, 10_000)).toLowerCase(),
    );
  } catch {
    return false;
  }
}

function findAlternateFeed(html: string, baseUrl: string): string | null {
  // <link rel="alternate" type="application/rss+xml" href="...">
  // Атрибуты в произвольном порядке.
  const linkRe = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const tag = m[0];
    const rel = (tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] ?? "").toLowerCase();
    if (!rel.includes("alternate")) continue;
    const type = (tag.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] ?? "").toLowerCase();
    if (!/rss|atom|xml/.test(type)) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}

function pickTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const t = m[1].replace(/\s+/g, " ").trim();
  return t.slice(0, 200) || null;
}
