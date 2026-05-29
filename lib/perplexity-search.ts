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
  opts: { timeoutMs?: number; model?: string } = {},
): Promise<PerplexitySearchResult> {
  const key = process.env.AIMLAPI_KEY;
  if (!key) throw new Error("AIMLAPI_KEY is not set");

  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const model = opts.model ?? "perplexity/sonar-pro";

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
              "You are a news researcher. Given a topic or headline, find recent news " +
              "articles (last 7 days, English or Russian) that report or analyze the same " +
              "event. Briefly summarize what you found and ALWAYS cite each source.",
          },
          { role: "user", content: query },
        ],
        // Sonar возвращает свои citations автоматически, response_format не нужен.
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
