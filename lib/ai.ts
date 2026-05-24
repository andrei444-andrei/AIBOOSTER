/**
 * AIMLAPI gateway — §4 конституции.
 *
 * OpenAI-совместимый API: один ключ `AIMLAPI_KEY` на все модели (GPT, Claude,
 * Gemini, Perplexity). Не заводим отдельных ключей провайдеров.
 *
 * Использование:
 *   const r = await chat({ model: MODELS.GPT_5, messages: [{ role: "user", content: "..." }] });
 *   console.log(r.choices[0].message.content);
 *
 *   // короче — для частого случая «system + один user-промт»:
 *   const text = await chatText({ model: MODELS.CLAUDE_SONNET, system: "...", user: "..." });
 */

const BASE_URL = "https://api.aimlapi.com/v1";

/**
 * Канонические идентификаторы моделей. Список не исчерпывающий — AIMLAPI
 * принимает любой ID, доступный в их каталоге. Здесь — флагманские пики
 * по принципу «качество > экономия».
 *
 * Reasoning-модели (gpt-5*, и подобные) тратят основную часть max_tokens
 * на внутренние рассуждения и возвращают пустой content, если бюджет
 * слишком маленький. Для них поднимай max_tokens до 1000+.
 */
export const MODELS = {
  // Безопасный универсальный дефолт: качественно, без reasoning-сюрпризов.
  CLAUDE_SONNET: "claude-sonnet-4-5",
  CLAUDE_OPUS: "claude-opus-4-1",
  GPT_5: "gpt-5", // reasoning — нужен высокий max_tokens
  GPT_5_MINI: "gpt-5-mini", // reasoning — нужен высокий max_tokens
  GPT_4O: "gpt-4o",
  GEMINI_PRO: "gemini-2.5-pro",
  GEMINI_FLASH: "gemini-2.5-flash",
  PERPLEXITY_SONAR: "perplexity/sonar-pro",
  // xAI Grok через AIMLAPI
  GROK_4: "x-ai/grok-4-07-09",
  GROK_3: "x-ai/grok-3-beta",
  // DeepSeek V3.1 серии (стабильные, не -exp)
  DEEPSEEK_V3: "deepseek/deepseek-chat-v3.1",
  DEEPSEEK_R1: "deepseek/deepseek-reasoner-v3.1",
} as const;

/** Дефолтная модель для общих задач, когда не выбрана явная. */
export const DEFAULT_MODEL = MODELS.CLAUDE_SONNET;

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" | "text" };
  stop?: string | string[];
  /** Произвольные дополнительные поля — пробрасываем как есть. */
  [key: string]: unknown;
}

export interface ChatCompletion {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class AIError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: string
  ) {
    super(message);
    this.name = "AIError";
  }
}

function getKeyOrThrow(): string {
  const k = process.env.AIMLAPI_KEY;
  if (!k) {
    throw new AIError("AIMLAPI_KEY is not set in environment", 503);
  }
  return k;
}

/**
 * Сырой вызов /chat/completions. Кидает AIError при HTTP/сетевой ошибке.
 */
export async function chat(opts: ChatOptions, init?: { signal?: AbortSignal }): Promise<ChatCompletion> {
  const key = getKeyOrThrow();
  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(opts),
    signal: init?.signal,
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new AIError(
      `AIMLAPI ${resp.status} ${resp.statusText}`,
      resp.status,
      body || undefined
    );
  }

  return (await resp.json()) as ChatCompletion;
}

/**
 * Стриминг ответа /chat/completions через Server-Sent Events.
 *
 * AIMLAPI совместим с OpenAI SSE-форматом: `data: {chunk-json}\n\n`, в конце
 * `data: [DONE]`. На каждой дельте контента вызывается onDelta(text). Когда
 * приходит usage, вызывается onUsage.
 *
 * Возвращает полный собранный текст по завершении.
 */
export interface StreamHandlers {
  onDelta?: (text: string) => void;
  onUsage?: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) => void;
}

export async function chatStream(
  opts: ChatOptions,
  handlers: StreamHandlers = {},
  init?: { signal?: AbortSignal },
): Promise<string> {
  const key = getKeyOrThrow();
  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ ...opts, stream: true }),
    signal: init?.signal,
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new AIError(`AIMLAPI ${resp.status} ${resp.statusText}`, resp.status, body || undefined);
  }
  if (!resp.body) {
    throw new AIError("AIMLAPI returned no body for stream", 502);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let full = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const event = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      for (const line of event.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          const obj = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
          };
          const delta = obj.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            full += delta;
            handlers.onDelta?.(delta);
          }
          if (obj.usage) handlers.onUsage?.(obj.usage);
        } catch {
          // битый чанк — пропускаем
        }
      }
    }
  }

  return full;
}

export interface ChatTextOptions {
  model: string;
  user: string;
  system?: string;
  temperature?: number;
  max_tokens?: number;
}

/**
 * Сахар для самого частого случая: дай один system + один user → получи текст.
 * Возвращает строку, без обёрток.
 */
export async function chatText(opts: ChatTextOptions, init?: { signal?: AbortSignal }): Promise<string> {
  const messages: ChatMessage[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });

  const r = await chat(
    {
      model: opts.model,
      messages,
      temperature: opts.temperature,
      max_tokens: opts.max_tokens,
    },
    init
  );

  const choice = r.choices[0];
  const text = choice?.message?.content;
  if (typeof text !== "string" || text.length === 0) {
    // Частый кейс с reasoning-моделями (gpt-5*): finish_reason === "length"
    // означает, что весь max_tokens ушёл на скрытые рассуждения.
    const hint =
      choice?.finish_reason === "length"
        ? " (max_tokens exhausted — for reasoning models, raise max_tokens to 1000+)"
        : "";
    throw new AIError(
      `AIMLAPI returned empty content${hint}`,
      502,
      JSON.stringify(r)
    );
  }
  return text;
}
