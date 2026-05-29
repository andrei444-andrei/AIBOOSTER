// Пайплайны для режимов Thinking и Pro — двухшаговая схема:
//   1. Sonar Pro тянет факты + источники из веба (non-stream, ~10с)
//   2. GPT-5(-mini) с reasoning синтезирует ответ поверх фактов (stream, 10-30с)
//
// Зачем два шага:
//   - GPT-5 через AIMLAPI не умеет web_search (OpenAI Chat Completions API
//     не даёт web_search для reasoning-моделей). Поэтому Sonar — отдельный шаг.
//   - Sonar очень быстрый (~10с) и приносит свежие данные + citations.
//   - GPT-5 поверх синтезирует и форматирует — это его сильная сторона.
//
// Контракт SSE — тот же, что для single-model flow:
//   route → delta → done. Дополнительно отправляются web_images и citations.
//   ensemble_start/candidate_done НЕ шлются (это для judge).

import {
  MODELS,
  chat,
  chatStream,
  chatText,
  AIError,
  normalizeCitation,
  normalizeImage,
  type ChatMessage,
  type ChatOptions,
  type WebCitation,
  type WebImage,
} from "./ai";
import type { ChatMode } from "./chat-client";

// ─── Веб-поиск ВСЕГДА на английском ──────────────────────────────
//
// Идея: английский веб в 10+ раз больше русского, лучше покрытие
// техники/науки/бизнеса/международных новостей, меньше SEO-спама.
// Поэтому переводим запрос на английский → Sonar ищет в English web →
// синтезатор GPT-5 переводит обратно в язык пользователя (это уже в
// правилах промта: «Язык — язык пользователя»).
//
// Локальные русские темы (новости Армении, цены в РФ и т.п.) могут
// слегка пострадать, но даже там часто есть качественные English
// источники (Reuters, Bloomberg, etc.).

export function hasCyrillic(s: string): boolean {
  return /[а-яА-ЯёЁ]/.test(s);
}

/** Если в тексте есть кириллица — переводим на английский через Flash.
 *  Soft-fail: при ошибке вернём оригинал. */
export async function translateQueryToEnglish(
  text: string,
  signal?: AbortSignal,
): Promise<{ original: string; english: string; translated: boolean }> {
  if (!hasCyrillic(text)) {
    return { original: text, english: text, translated: false };
  }
  try {
    const out = await chatText(
      {
        model: MODELS.GEMINI_FLASH,
        system: "Translate the user's query into natural English. Keep proper nouns as-is. Output ONLY the translation — no quotes, no comments, no preamble.",
        user: text,
        temperature: 0,
        max_tokens: 800,
      },
      { signal },
    );
    return { original: text, english: out.trim(), translated: true };
  } catch {
    return { original: text, english: text, translated: false };
  }
}

/** System-промт для Sonar: ищи в English web, отвечай на английском. */
export const SONAR_ENGLISH_SYSTEM =
  "Search English-language web sources for the best, most up-to-date information. " +
  "Respond in English. Your response will be synthesized into the user's language by another model.";

// ─── Конфиг режимов ────────────────────────────────────────────────

export interface ModeConfig {
  /** Какой GPT синтезирует. */
  synthModel: string;
  /** reasoning_effort для синтеза. */
  synthReasoning: "minimal" | "low" | "medium" | "high";
  /** max_tokens для синтеза. */
  synthMaxTokens: number;
  /** Какой Sonar собирает факты. */
  webModel: string;
  /** max_tokens для шага веб-поиска. */
  webMaxTokens: number;
}

export const MODE_CONFIG: Record<"thinking" | "pro", ModeConfig> = {
  thinking: {
    synthModel: MODELS.GPT_5_MINI,
    synthReasoning: "medium",
    synthMaxTokens: 6000,
    webModel: MODELS.PERPLEXITY_SONAR,
    webMaxTokens: 4000,
  },
  pro: {
    synthModel: MODELS.GPT_5,
    synthReasoning: "high",
    synthMaxTokens: 12000,
    webModel: MODELS.PERPLEXITY_SONAR,
    webMaxTokens: 6000,
  },
};

// ─── Типы ────────────────────────────────────────────────────────

export interface WebStep {
  text: string;
  citations: WebCitation[];
  images: WebImage[];
  duration_ms: number;
  tokens: number;
}

export interface PipelineHandlers {
  /** Стрим токенов синтеза (как обычный onDelta). */
  onDelta?: (text: string) => void;
  /** usage от синтез-модели. */
  onUsage?: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) => void;
  /** Картинки и цитаты от веб-шага. */
  onWebImages?: (images: WebImage[]) => void;
  onCitations?: (citations: WebCitation[]) => void;
  /** Когда веб-шаг закончился — для UI-индикатора. */
  onWebStepDone?: (step: { model: string; duration_ms: number; tokens: number; citations_count: number; images_count: number }) => void;
}

export interface RunPipelineOptions {
  mode: "thinking" | "pro";
  /** Сообщения для synth-модели (без веб-фактов). buildMessagesForModel(systemPrompt, history, synthModel). */
  synthMessages: Array<{ role: string; content: unknown }>;
  /** Текст последнего вопроса пользователя — для веб-запроса к Sonar (он не любит длинный контекст). */
  webQuery: string;
  signal?: AbortSignal;
}

export interface RunPipelineResult {
  text: string;
  webStep: WebStep | null;
  synth: { model: string; duration_ms: number; tokens: number };
  total_duration_ms: number;
}

// ─── Шаг 1: веб-поиск через Sonar ──────────────────────────────────

async function fetchWebFacts(
  config: ModeConfig,
  webQuery: string,
  signal: AbortSignal | undefined,
): Promise<WebStep> {
  const t = Date.now();
  // Переводим запрос на английский — больше и качественнее источников.
  const { english } = await translateQueryToEnglish(webQuery, signal);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reqOpts: any = {
    model: config.webModel,
    messages: [
      { role: "system", content: SONAR_ENGLISH_SYSTEM },
      { role: "user", content: english },
    ],
    max_tokens: config.webMaxTokens,
    return_images: true,
    return_related_questions: false,
  };
  const r = await chat(reqOpts, { signal });
  const duration_ms = Date.now() - t;
  const text = r.choices?.[0]?.message?.content ?? "";
  const tokens = r.usage?.completion_tokens ?? 0;

  // Citations + images с дедупом.
  const rawCits = Array.isArray(r.citations)
    ? r.citations
    : Array.isArray(r.search_results)
      ? r.search_results
      : [];
  const seenCit = new Set<string>();
  const citations: WebCitation[] = [];
  for (const c of rawCits) {
    const n = normalizeCitation(c);
    if (!n || seenCit.has(n.url)) continue;
    seenCit.add(n.url);
    citations.push(n);
  }
  const rawImgs = Array.isArray(r.images) ? r.images : [];
  const seenImg = new Set<string>();
  const images: WebImage[] = [];
  for (const img of rawImgs) {
    const n = normalizeImage(img);
    if (!n || seenImg.has(n.image_url)) continue;
    seenImg.add(n.image_url);
    images.push(n);
  }

  return { text, citations, images, duration_ms, tokens };
}

// ─── Промт для синтеза с веб-фактами ───────────────────────────────

/** Дополнительный system-блок, который добавляется к существующему system'у
 *  синтез-модели. Содержит свежие веб-факты + правила про inline-источники. */
export function buildWebContextSystem(web: WebStep): string {
  const lines: string[] = [];
  lines.push("ВЕБ-КОНТЕКСТ (свежие данные от Perplexity Sonar):");
  lines.push("");
  lines.push("--- Текст веб-ответа ---");
  lines.push(web.text);
  lines.push("--- Конец веб-ответа ---");
  lines.push("");
  if (web.citations.length > 0) {
    lines.push("ИСТОЧНИКИ (URL'ы по номерам):");
    web.citations.forEach((c, i) => {
      const title = c.title ? c.title.replace(/\s+/g, " ").trim() : "";
      lines.push(`[${i + 1}] ${title ? `${title} — ` : ""}${c.url}`);
    });
    lines.push("");
  }
  lines.push("ПРАВИЛА РАБОТЫ С ВЕБ-КОНТЕКСТОМ:");
  lines.push("- Используй эти факты как актуальный источник истины (свежее, чем твои знания).");
  lines.push("- Вшей URL'ы **inline** прямо в текст в формате `[короткое название](URL)` рядом с фактом, который оттуда взят. Не в конце предложения — а в той фразе, где идёт цифра/имя/дата.");
  lines.push("- В таблицах добавляй колонку «Источник» с кликабельной ссылкой `[название](url)` для каждой строки данных.");
  lines.push("- В САМОМ КОНЦЕ ответа — раздел `## Источники` или `**Источники:**` с нумерованным списком всех использованных URL.");
  lines.push("- Не пиши маркеры `[1]` без ссылки. Каждый номер → кликабельный `[\\[1\\]](url)`.");
  lines.push("- ЗАПРЕЩЕНО начинать ответ с «Короткий ответ:», «TL;DR:», «Кратко:», «Резюме:». Сразу с сути.");
  lines.push("- Если веб-факт противоречит твоим знаниям — доверяй вебу (он свежее), но осторожно: если факт выглядит шумом/SEO-спамом, отметь это.");
  return lines.join("\n");
}

// ─── Главная точка входа ──────────────────────────────────────────

export async function runPipeline(
  opts: RunPipelineOptions,
  handlers: PipelineHandlers = {},
): Promise<RunPipelineResult> {
  const { mode, synthMessages, webQuery, signal } = opts;
  const config = MODE_CONFIG[mode];
  const t0 = Date.now();

  // ── Шаг 1: Sonar тянет факты. Если упал — пайплайн НЕ валится: синтезируем
  //    без веб-контекста (как gpt-5 один). UI получает уведомление, что веб
  //    недоступен.
  let webStep: WebStep | null = null;
  try {
    webStep = await fetchWebFacts(config, webQuery, signal);
    if (webStep.images.length > 0) handlers.onWebImages?.(webStep.images);
    if (webStep.citations.length > 0) handlers.onCitations?.(webStep.citations);
    handlers.onWebStepDone?.({
      model: config.webModel,
      duration_ms: webStep.duration_ms,
      tokens: webStep.tokens,
      citations_count: webStep.citations.length,
      images_count: webStep.images.length,
    });
  } catch (err) {
    // Soft-fail на веб-шаге: продолжаем без него.
    // eslint-disable-next-line no-console
    console.warn("[pipeline] web step failed, continuing without web context:", err instanceof Error ? err.message : String(err));
  }

  // ── Шаг 2: GPT синтезирует. Web-контекст вшиваем дополнительным system-блоком.
  const messages: ChatMessage[] = synthMessages as ChatMessage[];
  if (webStep && webStep.text.trim()) {
    const webBlock = buildWebContextSystem(webStep);
    // Вставляем веб-блок ВТОРЫМ system'ом сразу после основного.
    // GPT-5 этот формат понимает — два system-сообщения подряд допустимы.
    const firstNonSystem = messages.findIndex((m) => m.role !== "system");
    const insertAt = firstNonSystem === -1 ? messages.length : firstNonSystem;
    messages.splice(insertAt, 0, { role: "system", content: webBlock });
  }

  const t1 = Date.now();
  const synthOpts: ChatOptions = {
    model: config.synthModel,
    messages,
    max_tokens: config.synthMaxTokens,
    reasoning_effort: config.synthReasoning,
  };

  let synthTokens = 0;
  const text = await chatStream(
    synthOpts,
    {
      onDelta: handlers.onDelta,
      onUsage: (u) => {
        synthTokens = u.completion_tokens;
        handlers.onUsage?.(u);
      },
    },
    { signal },
  );

  const synth_duration_ms = Date.now() - t1;
  return {
    text,
    webStep,
    synth: { model: config.synthModel, duration_ms: synth_duration_ms, tokens: synthTokens },
    total_duration_ms: Date.now() - t0,
  };
}

// ─── Решение Auto: какой mode выбрать ─────────────────────────────

/** Auto-роутер выбирает thinking или pro по сложности.
 *  Judge всегда opt-in (никогда не auto). */
export function pickAutoMode(complexity: "low" | "medium" | "high"): "thinking" | "pro" {
  if (complexity === "high") return "pro";
  return "thinking";
}
