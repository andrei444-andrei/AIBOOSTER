// Парсер публичной web-preview Telegram-каналов: https://t.me/s/CHANNEL.
//
// Эта страница — официальный публичный preview, который сам Telegram отдаёт
// для индексаторов. HTML стабильный, не требует Apify/MTProto/токена.
// Покрывает 95% use-кейса MVP: читать публичные новостные каналы.
//
// Что НЕ покрывает (если станет нужно — добавим MTProto):
// - приватные/закрытые каналы (на которые подписан пользователь)
// - реакции и количество просмотров (HTML их не отдаёт надёжно)
// - редактирование постов (внешний preview обновляется не сразу)

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_POSTS = 20;

export interface NormalizedTelegramPost {
  external_id: string;
  url: string;
  title: string | null;
  body: string;
  published_at: string | null;
  raw_meta: Record<string, unknown>;
}

export async function fetchTelegramChannel(
  channelUrl: string,
): Promise<NormalizedTelegramPost[]> {
  const previewUrl = toPreviewUrl(channelUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(previewUrl, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; AIBOOSTER-news/0.1; +https://aibooster.app)",
        accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`telegram fetch timeout after ${FETCH_TIMEOUT_MS}ms for ${previewUrl}`);
    }
    throw err;
  }
  clearTimeout(timer);

  if (!res.ok) {
    throw new Error(`telegram fetch ${res.status} for ${previewUrl}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`telegram preview too large: ${buf.byteLength} bytes`);
  }
  const html = new TextDecoder("utf-8").decode(buf);
  return parsePreview(html, channelUrl);
}

// Канал может прийти как https://t.me/CHANNEL, https://t.me/s/CHANNEL,
// @channelname или просто channelname.
function toPreviewUrl(input: string): string {
  let name = input.trim();
  name = name
    .replace(/^@/, "")
    .replace(/^https?:\/\/t\.me\/(s\/)?/i, "")
    .replace(/\/.*$/, "");
  if (!name) throw new Error(`invalid telegram channel: ${input}`);
  return `https://t.me/s/${name}`;
}

function parsePreview(html: string, sourceUrl: string): NormalizedTelegramPost[] {
  // Каждый пост обёрнут в <div class="tgme_widget_message_wrap ...">.
  // data-post="CHANNEL/N" даёт нам уникальный id. Берём максимум MAX_POSTS,
  // в порядке появления (свежие — внизу или вверху? — Telegram отдаёт по
  // возрастанию timestamp; берём последние N).
  const wraps = extractBlocks(html, /<div\s+class="tgme_widget_message_wrap[^"]*"[^>]*>/gi);
  const posts: NormalizedTelegramPost[] = [];
  for (const block of wraps) {
    const post = parsePostBlock(block, sourceUrl);
    if (post) posts.push(post);
  }
  // Берём N последних (самых свежих). t.me/s отдаёт ленту по возрастанию.
  if (posts.length > MAX_POSTS) {
    return posts.slice(posts.length - MAX_POSTS);
  }
  return posts;
}

function parsePostBlock(block: string, sourceUrl: string): NormalizedTelegramPost | null {
  // data-post="CHANNEL/MSG_ID" — основной идентификатор поста.
  const idMatch = block.match(/data-post="([^"]+)"/);
  if (!idMatch) return null;
  const externalId = idMatch[1];

  // Текст поста — внутри <div class="tgme_widget_message_text ...">...</div>.
  const textMatch = block.match(
    /<div\s+class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const rawBody = textMatch ? textMatch[1] : "";
  const body = htmlToText(rawBody);

  // Время — внутри <time datetime="...">.
  const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/);
  const publishedAt = timeMatch ? timeMatch[1] : null;

  // Линк на пост — https://t.me/CHANNEL/MSG_ID.
  const url = `https://t.me/${externalId}`;

  // Если пост целиком пустой — пропускаем (это бывает у reply-headers).
  if (!body.trim()) return null;

  const title = body.split("\n")[0]?.slice(0, 200) ?? null;

  return {
    external_id: externalId,
    url,
    title,
    body,
    published_at: publishedAt,
    raw_meta: { source: "tme_preview", source_url: sourceUrl },
  };
}

function extractBlocks(html: string, openRe: RegExp): string[] {
  // Ищем открывающий <div class="tgme_widget_message_wrap"> и матчим до
  // соответствующего </div> с учётом вложенности.
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(html))) {
    const start = m.index + m[0].length;
    const block = takeBalanced(html, start);
    if (block !== null) blocks.push(block);
  }
  return blocks;
}

function takeBalanced(html: string, start: number): string | null {
  // Простой подсчёт <div>/</div> с этой позиции. Не идеально для атрибутов
  // с экранированными скобками, но t.me HTML простой — без сюрпризов.
  let depth = 1;
  let i = start;
  while (i < html.length) {
    const next = html.indexOf("<", i);
    if (next === -1) return null;
    if (html.startsWith("<div", next)) {
      depth++;
      i = next + 4;
    } else if (html.startsWith("</div>", next)) {
      depth--;
      if (depth === 0) {
        return html.slice(start, next);
      }
      i = next + 6;
    } else {
      i = next + 1;
    }
  }
  return null;
}

function htmlToText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
