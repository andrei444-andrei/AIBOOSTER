// Конфигурация модуля исследований: дефолты бюджетов, выбор моделей и провайдера
// поиска, грубая оценка стоимости по токенам. Всё переопределяется через env.

import type { ResearchParams, SearchProvider } from "./types";

// Модели подтверждены вживую на шлюзе aimlapi (см. GET /v1/models):
//  - claude-sonnet-4-6        — планирование / судья / синтез
//  - claude-haiku-4-5-...     — извлечение факторов (быстрее/дешевле)
//  - sonar-pro (Perplexity)   — веб-поиск с цитатами (провайдер perplexity)
const DEFAULT_REASONING = "claude-sonnet-4-6";
const DEFAULT_EXTRACT = "claude-haiku-4-5-20251001";
const DEFAULT_SEARCH = "sonar-pro";

export function autoProvider(): SearchProvider {
  const explicit = process.env.SEARCH_PROVIDER?.toLowerCase();
  if (explicit === "exa" || explicit === "tavily" || explicit === "perplexity") {
    return explicit;
  }
  // Автовыбор по наличию ключа. Perplexity идёт через aimlapi и доступен всегда —
  // поэтому он безопасный fallback.
  if (process.env.EXA_API_KEY) return "exa";
  if (process.env.TAVILY_API_KEY) return "tavily";
  return "perplexity";
}

export function defaultParams(): ResearchParams {
  return {
    maxDepth: int(process.env.RESEARCH_MAX_DEPTH, 1),
    fanout: int(process.env.RESEARCH_FANOUT, 8),
    maxNodes: int(process.env.RESEARCH_MAX_NODES, 24),
    maxCostUsd: num(process.env.RESEARCH_MAX_COST_USD, 1.0),
    searchResults: int(process.env.RESEARCH_SEARCH_RESULTS, 6),
    reasoningModel: process.env.RESEARCH_REASONING_MODEL || DEFAULT_REASONING,
    extractModel: process.env.RESEARCH_EXTRACT_MODEL || DEFAULT_EXTRACT,
    searchModel: process.env.RESEARCH_SEARCH_MODEL || DEFAULT_SEARCH,
    searchProvider: autoProvider(),
  };
}

// Принимает частичный override (например из тела запроса) и нормализует диапазоны,
// чтобы прогон не ушёл в бесконечность/перерасход.
export function resolveParams(override?: Partial<ResearchParams>): ResearchParams {
  const p = { ...defaultParams(), ...(override ?? {}) };
  return {
    ...p,
    maxDepth: clamp(p.maxDepth, 0, 4),
    fanout: clamp(p.fanout, 1, 16),
    maxNodes: clamp(p.maxNodes, 1, 200),
    maxCostUsd: clamp(p.maxCostUsd, 0.01, 50),
    searchResults: clamp(p.searchResults, 1, 12),
  };
}

// Грубая оценка стоимости (USD) по токенам — для моделей, у которых шлюз не вернул
// фактическую цену (у sonar она есть и используется напрямую). Цены приблизительные,
// служат предохранителем бюджета, а не биллингом.
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
  "claude-opus-4-8": { in: 15, out: 75 },
  "sonar-pro": { in: 3, out: 15 },
  sonar: { in: 1, out: 1 },
};
const DEFAULT_PRICE = { in: 2, out: 6 };

export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const p = PRICES[model] ?? DEFAULT_PRICE;
  return (promptTokens / 1e6) * p.in + (completionTokens / 1e6) * p.out;
}

function int(v: string | undefined, d: number): number {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : d;
}
function num(v: string | undefined, d: number): number {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : d;
}
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(n, lo), hi);
}
