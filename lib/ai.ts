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
  // xAI Grok через AIMLAPI — ВСЕ варианты (4-07-09, 4-fast-reasoning,
  // 4-1-fast-reasoning, 3-beta) на текущий момент возвращают
  // AIMLAPI 500 Internal Server Error. Скорее всего несовместимый формат
  // запроса (system+messages). Возвращаем когда поймём root cause.
  // GROK_4: "x-ai/grok-4-1-fast-reasoning",
  // GROK_3: "x-ai/grok-3-beta",
  // DeepSeek V3.1 серии (стабильные, не -exp)
  DEEPSEEK_V3: "deepseek/deepseek-chat-v3.1",
  DEEPSEEK_R1: "deepseek/deepseek-reasoner-v3.1",
  // Image generation — через /v1/images/generations endpoint
  IMAGEN_4: "google/imagen-4.0-generate-001",
  IMAGEN_4_FAST: "google/imagen-4.0-fast-generate-001",
  FLUX_PRO: "flux-pro/v1.1",
  DALL_E_3: "dall-e-3",
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
  // Веб-поисковые модели (Perplexity Sonar и др.) добавляют верхнеуровневые
  // поля с источниками и картинками. У обычных моделей их нет.
  images?: unknown[];
  citations?: unknown[];
  search_results?: unknown[];
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
/** Картинка от веб-поиска (Perplexity Sonar `return_images: true`). */
export interface WebImage {
  /** URL картинки. */
  image_url: string;
  /** URL исходной страницы (опционально). */
  origin_url?: string;
  /** Заголовок страницы-источника (опционально). */
  title?: string;
}

/** Цитата от веб-поиска. */
export interface WebCitation {
  url: string;
  title?: string;
}

export interface StreamHandlers {
  onDelta?: (text: string) => void;
  onUsage?: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) => void;
  /** Картинки от веб-поиска (если модель их вернула — Perplexity Sonar и др.). */
  onImages?: (images: WebImage[]) => void;
  /** Источники-цитаты, на которые ссылается модель. */
  onCitations?: (citations: WebCitation[]) => void;
}

interface PplxImageItem {
  image_url?: string;
  url?: string;
  origin_url?: string;
  origin?: string;
  title?: string;
}
interface PplxCitationItem {
  url?: string;
  title?: string;
}
export function normalizeImage(it: unknown): WebImage | null {
  if (typeof it === "string") return { image_url: it };
  if (!it || typeof it !== "object") return null;
  const x = it as PplxImageItem;
  const url = x.image_url ?? x.url;
  if (!url || typeof url !== "string") return null;
  return { image_url: url, origin_url: x.origin_url ?? x.origin, title: x.title };
}
export function normalizeCitation(it: unknown): WebCitation | null {
  if (typeof it === "string") return { url: it };
  if (!it || typeof it !== "object") return null;
  const x = it as PplxCitationItem;
  if (!x.url || typeof x.url !== "string") return null;
  return { url: x.url, title: x.title };
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
            // Perplexity Sonar и им подобные шлют доп. поля в финальном/верхнем chunk:
            images?: unknown[];
            citations?: unknown[];
            search_results?: unknown[];
          };
          const delta = obj.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            full += delta;
            handlers.onDelta?.(delta);
          }
          if (obj.usage) handlers.onUsage?.(obj.usage);
          // Картинки и цитаты от Perplexity: могут быть в любом chunk.
          // Дедупликацию пускай делает потребитель — сюда отправим как есть.
          if (Array.isArray(obj.images) && obj.images.length > 0) {
            const imgs = obj.images.map(normalizeImage).filter(Boolean) as WebImage[];
            if (imgs.length) handlers.onImages?.(imgs);
          }
          if (Array.isArray(obj.citations) && obj.citations.length > 0) {
            const cits = obj.citations.map(normalizeCitation).filter(Boolean) as WebCitation[];
            if (cits.length) handlers.onCitations?.(cits);
          }
          // search_results тоже могут содержать url + title (без image) — берём как цитаты.
          if (Array.isArray(obj.search_results) && obj.search_results.length > 0) {
            const cits = obj.search_results.map(normalizeCitation).filter(Boolean) as WebCitation[];
            if (cits.length) handlers.onCitations?.(cits);
          }
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

// ─── Генерация изображений ──────────────────────────────────────────
//
// AIMLAPI поддерживает /v1/images/generations с моделями imagen-4, flux-pro,
// dall-e-3 и др. Формат ответа близок к OpenAI: { data: [{ url } | { b64_json }] }.
// Некоторые модели возвращают url (временный, ~1 час), некоторые base64.
// Нормализуем оба варианта в один — Buffer + mime.

export interface ImageGenOptions {
  model: string;
  prompt: string;
  /** Размер: 1024x1024 (default), 1792x1024, 1024x1792, 512x512. Не все модели поддерживают все размеры. */
  size?: string;
  /** Сколько вариантов сгенерировать (default 1). */
  n?: number;
}

export interface GeneratedImage {
  /** base64 без data: префикса. */
  base64: string;
  /** MIME-тип (по умолчанию image/png). */
  mime: string;
}

interface ImageGenResponse {
  data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
  /** Некоторые модели (Imagen) возвращают images вместо data. */
  images?: Array<{ url?: string; b64_json?: string }>;
}

/** Скачивает URL и возвращает base64 + MIME. */
async function fetchImageAsBase64(url: string): Promise<GeneratedImage> {
  const r = await fetch(url);
  if (!r.ok) {
    throw new AIError(`failed to fetch generated image: ${r.status}`, r.status);
  }
  const mime = r.headers.get("content-type") ?? "image/png";
  const buf = Buffer.from(await r.arrayBuffer());
  return { base64: buf.toString("base64"), mime };
}

export async function generateImage(
  opts: ImageGenOptions,
  init?: { signal?: AbortSignal },
): Promise<GeneratedImage[]> {
  const key = getKeyOrThrow();
  const body: Record<string, unknown> = {
    model: opts.model,
    prompt: opts.prompt,
    n: opts.n ?? 1,
  };
  if (opts.size) body.size = opts.size;

  const resp = await fetch(`${BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal: init?.signal,
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new AIError(
      `AIMLAPI image-gen ${resp.status} ${resp.statusText}`,
      resp.status,
      errBody || undefined,
    );
  }

  const payload = (await resp.json()) as ImageGenResponse;
  const items = payload.data ?? payload.images ?? [];
  if (items.length === 0) {
    throw new AIError("AIMLAPI image-gen returned empty data array", 502, JSON.stringify(payload));
  }

  const out: GeneratedImage[] = [];
  for (const it of items) {
    if (it.b64_json) {
      out.push({ base64: it.b64_json, mime: "image/png" });
    } else if (it.url) {
      try {
        out.push(await fetchImageAsBase64(it.url));
      } catch (err) {
        // Если одна картинка не скачалась — пропускаем, остальные могут быть валидны.
        // eslint-disable-next-line no-console
        console.warn("[image-gen] failed to fetch image:", err);
      }
    }
  }
  if (out.length === 0) {
    throw new AIError("AIMLAPI image-gen: none of returned images could be decoded", 502, JSON.stringify(payload));
  }
  return out;
}
