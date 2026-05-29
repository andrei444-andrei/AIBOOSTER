// Perplexity Sonar через aimlapi.com — web-search с цитатами.
//
// Sonar-pro — модель Perplexity, специально натренированная искать в вебе и
// возвращать ответ со ссылками на источники. Это намного дешевле и точнее,
// чем «GPT с custom search tool».
//
// API формат тот же chat-completions, что и у Claude. Ответ: контент-текст
// + поле `citations` (array of URLs) в сообщении. У некоторых
// версий — в top-level `search_results`.

const BASE = process.env.AIMLAPI_BASE || "https://api.aimlapi.com/v1";

export interface PerplexitySearchResult {
  answer: string;
  citations: string[];
  raw: unknown;
  cost_cents: number;
  latency_ms: number;
}

export async function perplexitySearch(
  query: string,
  opts: { timeoutMs?: number; model?: string; recencyFilter?: "day" | "week" | "month" | "year" } = {},
): Promise<PerplexitySearchResult> {
  const key = process.env.AIMLAPI_KEY;
  if (!key) throw new Error("AIMLAPI_KEY is not set");

  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 25_000;
  // sonar (без -pro): быстрее (~5-10s) и достаточно для нашего use-case.
  // sonar-pro системно бьёт 25-35s, что не помещается в наш бюджет.
  const model = opts.model ?? "perplexity/sonar";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a news researcher. Search the ENGLISH-language web for the most authoritative and recent " +
              "primary sources covering the user's topic. Always prefer primary outlets (Axios, Reuters, " +
              "Bloomberg, WSJ, AP, FT, NYT, official press releases). Briefly summarize what you found in " +
              "English and ALWAYS cite each source with a URL. Note publication dates when available.",
          },
          { role: "user", content: query },
        ],
        ...(opts.recencyFilter ? { search_recency_filter: opts.recencyFilter } : {}),
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`perplexity timeout after ${timeoutMs}ms`);
    }
    throw err;
  }
  clearTimeout(timer);

  const latencyMs = Date.now() - started;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`perplexity ${res.status}: ${text.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    citations?: string[];
    search_results?: Array<{ url?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const answer = data.choices?.[0]?.message?.content ?? "";

  // Достаём цитаты: возможные форматы — top-level `citations`, или
  // top-level `search_results` (массив {url, title, ...}).
  let citations: string[] = [];
  if (Array.isArray(data.citations)) {
    citations = data.citations.filter((s): s is string => typeof s === "string");
  } else if (Array.isArray(data.search_results)) {
    citations = data.search_results
      .map((r) => r.url)
      .filter((s): s is string => typeof s === "string");
  } else {
    // Fallback: вытаскиваем URL из текста (Markdown ссылки + сырые https://).
    citations = extractUrlsFromText(answer);
  }
  // Дедуп и нормализация.
  citations = [...new Set(citations.map((u) => u.trim()))].filter((u) => u.startsWith("http"));

  // Грубая оценка стоимости. Sonar-pro: ~$3/1M input + $15/1M output (актуально на 2026).
  const inT = data.usage?.prompt_tokens ?? 0;
  const outT = data.usage?.completion_tokens ?? 0;
  const cost_cents = Math.ceil((inT * 0.0003 + outT * 0.0015) * 100);

  return { answer, citations, raw: data, cost_cents, latency_ms: latencyMs };
}

function extractUrlsFromText(text: string): string[] {
  const re = /https?:\/\/[^\s)<>'"]+/g;
  const found = text.match(re) || [];
  return found.map((u) => u.replace(/[.,;:!?)\]]+$/, ""));
}

// Sonar URL-read fallback: когда наш HTML-scraper не смог достать текст
// (paywall / JS-SPA / Cloudflare-блок), просим Perplexity сам прочитать
// конкретный URL. У Perplexity свой crawler с data-deals со многими
// изданиями, часто он видит то, что нам недоступно. ~$0.005-0.01 за вызов.
export interface SonarUrlReadResult {
  text: string;
  title: string | null;
  published_at: string | null;
  cost_cents: number;
  latency_ms: number;
}

export async function sonarUrlRead(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<SonarUrlReadResult> {
  const key = process.env.AIMLAPI_KEY;
  if (!key) throw new Error("AIMLAPI_KEY is not set");
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "perplexity/sonar",
        messages: [
          {
            role: "system",
            content:
              "You are an article reader. Read the article at the URL given and produce a faithful, " +
              "thorough extract IN ENGLISH that preserves: headline, byline/author, publication date, " +
              "ALL key facts, numbers, quotes (verbatim), names, dates, locations. Do not summarize " +
              "lossily — keep specifics. Do not invent. If the article is paywalled or unreadable, say " +
              "exactly: 'UNREADABLE'.",
          },
          {
            role: "user",
            content:
              `Read and extract this article fully:\n${url}\n\nFormat:\n` +
              `TITLE: <headline>\nDATE: <publication date if known>\nAUTHOR: <if known>\n\nBODY:\n<full extract>`,
          },
        ],
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`sonar-url-read timeout after ${timeoutMs}ms`);
    }
    throw err;
  }
  clearTimeout(timer);
  const latencyMs = Date.now() - started;
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`sonar-url-read ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const raw = data.choices?.[0]?.message?.content ?? "";
  if (/^\s*UNREADABLE\s*$/i.test(raw)) {
    return { text: "", title: null, published_at: null, cost_cents: 0, latency_ms: latencyMs };
  }
  const titleMatch = raw.match(/^TITLE:\s*(.+)$/m);
  const dateMatch = raw.match(/^DATE:\s*(.+)$/m);
  const bodyMatch = raw.match(/^BODY:\s*([\s\S]+)$/m);

  let pub: string | null = null;
  if (dateMatch) {
    const t = Date.parse(dateMatch[1].trim());
    if (!Number.isNaN(t)) pub = new Date(t).toISOString();
  }
  const text = (bodyMatch ? bodyMatch[1] : raw).trim();
  const inT = data.usage?.prompt_tokens ?? 0;
  const outT = data.usage?.completion_tokens ?? 0;
  const cost_cents = Math.ceil((inT * 0.0003 + outT * 0.0015) * 100);
  return {
    text: text.length >= 100 ? text : "",
    title: titleMatch ? titleMatch[1].trim() : null,
    published_at: pub,
    cost_cents,
    latency_ms: latencyMs,
  };
}
