// Apify fallback для article extraction. Подключается, когда наш HTML-scraper
// И Sonar URL-read не справились — обычно из-за JS-рендера или специфичного
// Cloudflare-fingerprinting'а на дорогих изданиях (Bloomberg, FT, WSJ).
//
// Используем actor apify/website-content-crawler в режиме одной страницы.
// Это официальный, поддерживаемый Apify актор для извлечения content из
// произвольных сайтов. Возвращает markdown + metadata.
//
// Actor ID можно переопределить env'ом APIFY_ARTICLE_ACTOR (например, если
// захочется попробовать lukaskrivka/article-extractor-smart).

const BASE = "https://api.apify.com/v2";

function actorId(): string {
  return (process.env.APIFY_ARTICLE_ACTOR || "apify/website-content-crawler").replace("/", "~");
}

export interface ApifyArticleResult {
  text: string;
  title: string | null;
  published_at: string | null;
  cost_cents: number;
  latency_ms: number;
}

export async function fetchArticleViaApify(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<ApifyArticleResult> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN not set");

  const started = Date.now();
  // Apify runs are billed per compute unit (~$0.0005/sec). Кап 45с дает ~$0.02
  // за неудачные попытки. Удачный run обычно 10-20с, ~$0.05-0.10.
  const timeoutMs = opts.timeoutMs ?? 45_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(
      `${BASE}/acts/${actorId()}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startUrls: [{ url }],
          maxCrawlPages: 1,
          maxCrawlDepth: 0,
          crawlerType: "playwright:firefox",
          saveMarkdown: true,
          saveHtml: false,
          saveScreenshots: false,
          // Игнорируем стандартный robots.txt — официальные новостные сайты
          // его не запрещают для нашего use-case, но Apify по умолчанию
          // соблюдает строго.
          respectRobotsTxtFile: false,
        }),
      },
    );
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`apify-article timeout after ${timeoutMs}ms`);
    }
    throw err;
  }
  clearTimeout(timer);

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`apify-article ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as Array<{
    text?: string;
    markdown?: string;
    title?: string | null;
    metadata?: { title?: string | null; description?: string; datePublished?: string };
  }>;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("apify-article: empty dataset");
  }
  const first = data[0];
  const text = (first.markdown || first.text || "").trim();
  if (text.length < 200) {
    throw new Error(`apify-article: text too short (${text.length} chars)`);
  }
  const meta = first.metadata ?? {};
  let pub: string | null = null;
  if (meta.datePublished) {
    const t = Date.parse(meta.datePublished);
    if (!Number.isNaN(t)) pub = new Date(t).toISOString();
  }
  return {
    text: text.slice(0, 15_000),
    title: first.title || meta.title || null,
    published_at: pub,
    // Грубая оценка: ~10-20s Apify time × $0.0005/s × 100¢ = ~5-10¢.
    cost_cents: Math.ceil(((Date.now() - started) / 1000) * 0.05 * 100),
    latency_ms: Date.now() - started,
  };
}
