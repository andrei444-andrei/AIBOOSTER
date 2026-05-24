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
