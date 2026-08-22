// HTML-скрейп главной страницы новостного сайта без RSS.
//
// Эвристика: ищем ссылки с длинным текстом (выглядит как заголовок) и
// ведущие на тот же origin (внутренние материалы, не nav-/футер-линки).
// Это не «универсальный» скрейпер — для серьёзных сайтов с пейволами
// (Bloomberg, FT) тело статьи не получим, но заголовок + URL хватит,
// чтобы валидатор оценил релевантность по заголовку.

import { assertPublicHttpUrl } from "./rss";

const FETCH_TIMEOUT_MS = 15_000;
// Парсим максимум 3MB HTML — большинство новостных сайтов помещаются, у
// Bloomberg первые 3MB точно содержат все главные карточки.
const SCRAPE_BYTES = 3 * 1024 * 1024;
const MAX_ITEMS = 30;
const MIN_TITLE_LEN = 25;
const MAX_TITLE_LEN = 300;

// Многие сайты (The Verge, NYT, и т.д.) дают 403 на не-браузерные UA.
// Маскируемся под обычный Chrome — для публичного контента это нормальная
// практика, мы не пытаемся обходить login/paywall.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export interface NormalizedWebItem {
  external_id: string;
  url: string;
  title: string | null;
  body: string;
  published_at: string | null;
  raw_meta: Record<string, unknown>;
}

export async function fetchWebHeadlines(
  homepageUrl: string,
): Promise<NormalizedWebItem[]> {
  assertPublicHttpUrl(homepageUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(homepageUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": BROWSER_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9,ru;q=0.8",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`web fetch timeout after ${FETCH_TIMEOUT_MS}ms for ${homepageUrl}`);
    }
    throw err;
  }
  clearTimeout(timer);
  if (!res.ok) throw new Error(`web fetch ${res.status} for ${homepageUrl}`);
  const buf = await res.arrayBuffer();
  // Если страница огромная (Bloomberg ~8MB) — берём первые 3MB. Этого с
  // запасом хватает, чтобы выцепить главные карточки новостей.
  const slice = buf.byteLength > SCRAPE_BYTES ? buf.slice(0, SCRAPE_BYTES) : buf;
  const html = new TextDecoder("utf-8").decode(slice);

  return extractHeadlines(html, homepageUrl);
}

export function extractHeadlines(html: string, baseUrl: string): NormalizedWebItem[] {
  const base = new URL(baseUrl);
  // Грубо вырезаем <script>/<style>/<svg> и nav/footer/aside — там не контент.
  const cleaned = html
    .replace(/<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(nav|footer|aside|header)\b[\s\S]*?<\/\1\s*>/gi, "");

  const linkRe = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  const items: NormalizedWebItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(cleaned))) {
    const attrs = m[1] ?? "";
    const inner = m[2] ?? "";
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;

    let absUrl: URL;
    try {
      absUrl = new URL(href, base.origin);
    } catch {
      continue;
    }
    // Только тот же origin — отфильтровываем выходящие линки (соцсети, рекламу).
    if (absUrl.origin !== base.origin) continue;
    // Скучные пути: главная, корневые рубрики типа /sports.
    if (/^\/?(\?.*)?$/.test(absUrl.pathname)) continue;
    if (absUrl.pathname.split("/").filter(Boolean).length < 2) continue;
    // Уже взяли — пропускаем дубликаты (часто один пост ссылается несколько раз).
    if (seen.has(absUrl.toString())) continue;

    const title = htmlToText(inner);
    if (title.length < MIN_TITLE_LEN) continue;
    if (title.length > MAX_TITLE_LEN) continue;

    seen.add(absUrl.toString());
    items.push({
      external_id: pathAsId(absUrl),
      url: absUrl.toString(),
      title,
      body: "",
      published_at: null,
      raw_meta: { source: "web_scrape", base_url: baseUrl },
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

function pathAsId(u: URL): string {
  // Используем pathname (без query/hash) как стабильный external_id.
  // Это устойчиво к UTM и якорным ссылкам.
  return u.pathname.slice(0, 500);
}

function htmlToText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\s+/g, " ")
    .trim();
}
