// Абстракция веб-поиска с тремя провайдерами:
//  - exa        — нейропоиск + сырые документы (нужен EXA_API_KEY)
//  - tavily     — поиск + готовый answer (нужен TAVILY_API_KEY)
//  - perplexity — sonar через aimlapi (CONSTITUTION §3), всегда доступен как fallback
//
// ВАЖНО (исключение из §3): exa/tavily — это поисковые API, а не AI-модели, поэтому
// у них отдельные ключи и они не идут через aimlapi. Это сознательное исключение,
// задокументированное в .env.example.

import { chat } from "./llm";
import { estimateCost } from "./config";
import type { SearchProvider, SearchSource } from "./types";

export interface SearchOutcome {
  text: string; // синтезированный ответ (perplexity/tavily) либо склейка сниппетов (exa)
  sources: SearchSource[];
  costUsd: number; // 0, если провайдер не сообщает стоимость
}

export async function search(
  query: string,
  n: number,
  provider: SearchProvider,
  searchModel: string,
): Promise<SearchOutcome> {
  if (provider === "exa") return searchExa(query, n);
  if (provider === "tavily") return searchTavily(query, n);
  return searchPerplexity(query, n, searchModel);
}

async function searchPerplexity(
  query: string,
  n: number,
  model: string,
): Promise<SearchOutcome> {
  const r = await chat({
    model,
    temperature: 0,
    maxTokens: 900,
    messages: [
      {
        role: "system",
        content:
          "Ты — исследовательский веб-поиск. Дай сжатый ответ по сути с ключевыми " +
          "фактами и обязательно опирайся на источники.",
      },
      { role: "user", content: query },
    ],
  });

  const results = r.raw.search_results ?? [];
  let sources: SearchSource[] = results.slice(0, n).map((s) => ({
    title: s.title ?? s.url ?? "",
    url: s.url ?? "",
    snippet: s.snippet ?? "",
    date: s.date ?? null,
  }));
  // Если структурированных результатов нет — берём голые citations как источники.
  if (sources.length === 0 && r.raw.citations) {
    sources = r.raw.citations.slice(0, n).map((url) => ({ title: url, url, snippet: "" }));
  }

  const cost =
    r.usage.costUsd ??
    estimateCost(model, r.usage.promptTokens, r.usage.completionTokens);
  return { text: r.content, sources, costUsd: cost };
}

interface ExaResult {
  title?: string;
  url?: string;
  text?: string;
  snippet?: string;
  publishedDate?: string;
}
async function searchExa(query: string, n: number): Promise<SearchOutcome> {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY is not set (SEARCH_PROVIDER=exa)");

  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      query,
      numResults: n,
      type: "auto",
      contents: { text: { maxCharacters: 1500 } },
    }),
  });
  if (!res.ok) {
    throw new Error(`exa search -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { results?: ExaResult[] };
  const results = data.results ?? [];
  const sources: SearchSource[] = results.map((r) => ({
    title: r.title ?? r.url ?? "",
    url: r.url ?? "",
    snippet: (r.text ?? r.snippet ?? "").slice(0, 1500),
    date: r.publishedDate ?? null,
  }));
  const text = sources
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.snippet}`)
    .join("\n\n");
  return { text, sources, costUsd: 0 };
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
}
async function searchTavily(query: string, n: number): Promise<SearchOutcome> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("TAVILY_API_KEY is not set (SEARCH_PROVIDER=tavily)");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: n,
      search_depth: "advanced",
      include_answer: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`tavily search -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { answer?: string; results?: TavilyResult[] };
  const results = data.results ?? [];
  const sources: SearchSource[] = results.map((r) => ({
    title: r.title ?? r.url ?? "",
    url: r.url ?? "",
    snippet: (r.content ?? "").slice(0, 1500),
    date: r.published_date ?? null,
  }));
  const text =
    (data.answer ? data.answer + "\n\n" : "") +
    sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.snippet}`).join("\n\n");
  return { text, sources, costUsd: 0 };
}
