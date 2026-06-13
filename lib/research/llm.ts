// Клиент к AI-шлюзу aimlapi.com (OpenAI-совместимый). Один ключ на все модели
// (CONSTITUTION §4). Здесь только chat-вызовы и устойчивый разбор JSON-ответов —
// модели подключаются исключительно через этот шлюз. Назван llm.ts, чтобы не
// конфликтовать с общим lib/ai.ts продукта; это тонкая обёртка под нужды модуля
// (нормализованный usage + стоимость от sonar + JSON-режим с jsonrepair).
import { jsonrepair } from "jsonrepair";

const BASE =
  process.env.AIMLAPI_BASE_URL?.replace(/\/$/, "") || "https://api.aimlapi.com/v1";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  // Стоимость в USD, если шлюз её вернул (Perplexity/sonar возвращает). Иначе null —
  // тогда вызывающий оценивает по токенам (см. lib/research/config.ts:estimateCost).
  costUsd: number | null;
}

// Минимальная форма ответа шлюза. Для sonar здесь же приходят citations/search_results.
export interface ApiSearchResult {
  title?: string;
  url?: string;
  snippet?: string;
  date?: string | null;
}
export interface ApiResponse {
  choices?: { message?: { content?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: { total_cost?: number };
  };
  citations?: string[];
  search_results?: ApiSearchResult[];
}

export interface ChatResult {
  content: string;
  usage: Usage;
  raw: ApiResponse;
}

export class AiError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "AiError";
    this.status = status;
  }
}

export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const key = process.env.AIMLAPI_KEY;
  if (!key) throw new AiError("AIMLAPI_KEY is not set", 503);

  let res: Response;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0,
        max_tokens: opts.maxTokens ?? 1024,
      }),
      signal: opts.signal,
    });
  } catch (err) {
    throw new AiError(
      `aimlapi request failed (${opts.model}): ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AiError(
      `aimlapi chat ${opts.model} -> ${res.status}: ${text.slice(0, 300)}`,
      res.status,
    );
  }

  const data = (await res.json()) as ApiResponse;
  const rawContent = data.choices?.[0]?.message?.content ?? "";
  const u = data.usage ?? {};

  return {
    content: typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent),
    usage: {
      promptTokens: Number(u.prompt_tokens ?? 0),
      completionTokens: Number(u.completion_tokens ?? 0),
      totalTokens: Number(u.total_tokens ?? 0),
      costUsd: u.cost?.total_cost != null ? Number(u.cost.total_cost) : null,
    },
    raw: data,
  };
}

// Просит модель вернуть JSON и устойчиво его парсит (без опоры на response_format,
// которого нет у части моделей шлюза). При неудаче — одна попытка-нудж.
export async function chatJSON<T>(opts: ChatOptions): Promise<{ data: T; usage: Usage }> {
  const r = await chat(opts);
  const parsed = parseJsonLoose(r.content);
  if (parsed !== undefined) {
    return { data: parsed as T, usage: r.usage };
  }

  const retry = await chat({
    ...opts,
    messages: [
      ...opts.messages,
      { role: "assistant", content: r.content.slice(0, 2000) },
      {
        role: "user",
        content:
          "Верни ТОЛЬКО валидный JSON без пояснений и без markdown-ограждений (```).",
      },
    ],
  });
  const p2 = parseJsonLoose(retry.content);
  if (p2 === undefined) {
    throw new AiError(
      `model ${opts.model} did not return JSON: ${r.content.slice(0, 200)}`,
      502,
    );
  }
  return { data: p2 as T, usage: addUsage(r.usage, retry.usage) };
}

export function addUsage(a: Usage, b: Usage): Usage {
  const cost =
    a.costUsd == null && b.costUsd == null ? null : (a.costUsd ?? 0) + (b.costUsd ?? 0);
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    costUsd: cost,
  };
}

// Достаёт первый JSON-объект/массив из текста модели: снимает ```-ограждения,
// берёт срез от первой { или [ до парной закрывающей скобки.
function parseJsonLoose(s: string): unknown | undefined {
  if (!s) return undefined;
  let t = s.trim();

  // снять markdown-ограждения ```json ... ```
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  // прямой парс
  try {
    return JSON.parse(t);
  } catch {
    // ниже — попытка вырезать сбалансированный фрагмент
  }

  const start = firstJsonStart(t);
  if (start < 0) return tryRepair(t);
  const open = t[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const frag = t.slice(start, i + 1);
        try {
          return JSON.parse(frag);
        } catch {
          return tryRepair(frag);
        }
      }
    }
  }
  return tryRepair(t);
}

// Последний рубеж: чиним «почти-JSON» (висячие запятые, одинарные кавычки и т.п.).
function tryRepair(s: string): unknown | undefined {
  try {
    return JSON.parse(jsonrepair(s));
  } catch {
    return undefined;
  }
}

function firstJsonStart(t: string): number {
  const a = t.indexOf("{");
  const b = t.indexOf("[");
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}
