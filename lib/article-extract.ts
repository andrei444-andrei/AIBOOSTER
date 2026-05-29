// Лёгкий текстовый readability-эрзац: качаем HTML, выкидываем мусор
// (script/style/nav/footer), оставляем содержимое <article> / <main> /
// крупных <div> с большим количеством текста. Возвращаем чистый текст
// для подачи в LLM.
//
// Не Mozilla Readability — но достаточно для подачи новостной статьи
// в Opus как контекст. Браузерный UA + бюджет байт, чтобы пройти
// типовые bot-фильтры.

import { assertPublicHttpUrl } from "./rss";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_TEXT_CHARS = 12_000;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export interface ExtractedArticle {
  url: string;
  title: string | null;
  text: string;
  // Если из meta или og:image — пригодится в фазе 2 для vision.
  image_urls: string[];
}

export async function extractArticle(url: string): Promise<ExtractedArticle> {
  assertPublicHttpUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
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
      throw new Error(`article fetch timeout after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  }
  clearTimeout(timer);
  if (!res.ok) throw new Error(`article fetch ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  const slice = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
  const html = new TextDecoder("utf-8").decode(slice);

  return parseArticle(html, url);
}

export function parseArticle(html: string, baseUrl: string): ExtractedArticle {
  const title = pickMeta(html, "og:title") || pickTitle(html);
  const image_urls = collectImages(html, baseUrl);

  // Удаляем не-контентные секции до текстового извлечения.
  const cleaned = html
    .replace(/<(script|style|noscript|template|svg|iframe)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(nav|footer|aside|header)\b[\s\S]*?<\/\1\s*>/gi, "");

  // Берём <article> если есть, иначе <main>, иначе всё.
  let region =
    matchFirst(cleaned, /<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
    matchFirst(cleaned, /<main\b[^>]*>([\s\S]*?)<\/main>/i) ||
    cleaned;

  // Бьём на параграфы, ищем длинные блоки — это и есть тело статьи.
  region = region
    .replace(/<\/?(p|h\d|li|br|div)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

  // Чистка пробелов: каждая строка обрезается, пустые строки схлопываются.
  const lines = region
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);

  // Отбрасываем короткие строки длиной < 40 (обычно меню, ссылки).
  const meaningful = lines.filter((l) => l.length >= 40 || /[.!?…]$/.test(l));

  const text = (meaningful.length > 5 ? meaningful : lines).join("\n\n").slice(0, MAX_TEXT_CHARS);

  return { url: baseUrl, title, text, image_urls };
}

function matchFirst(s: string, re: RegExp): string | null {
  const m = s.match(re);
  return m ? m[1] : null;
}

function pickMeta(html: string, prop: string): string | null {
  // <meta property="og:title" content="...">
  const re = new RegExp(
    `<meta[^>]*\\b(?:property|name)\\s*=\\s*["']${prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`,
    "i",
  );
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
  return content?.trim() || null;
}

function pickTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  return m[1].replace(/\s+/g, " ").trim() || null;
}

function collectImages(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const ogImage = pickMeta(html, "og:image");
  if (ogImage) tryPush(ogImage, baseUrl, out);
  const twitterImage = pickMeta(html, "twitter:image");
  if (twitterImage) tryPush(twitterImage, baseUrl, out);
  // Большие <img> внутри <article> — пока просто все <img>, фильтрация
  // оставлена на фазу 2 vision (там и будем смотреть размеры).
  const imgRe = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html))) {
    tryPush(m[1], baseUrl, out);
    if (out.size > 10) break;
  }
  return [...out];
}

function tryPush(href: string, baseUrl: string, set: Set<string>): void {
  try {
    const abs = new URL(href, baseUrl).toString();
    if (abs.startsWith("http")) set.add(abs);
  } catch {
    /* ignore */
  }
}
