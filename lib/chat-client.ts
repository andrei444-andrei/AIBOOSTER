// Чистые константы и типы для клиентской части модуля чата.
// Тут НЕ должно быть node:crypto и обращений к БД — этот файл тянется в браузер.

import { MODELS } from "./ai";

// ─── Модели ──────────────────────────────────────────────────────────

export type ModelTier = "fast" | "balanced" | "deep";

export interface ModelOption {
  id: string;
  label: string;
  vendor: string;
  multimodal: boolean;
  description: string;
  /** fast = ≤10s, balanced = 10–30s, deep = >30s. */
  tier: ModelTier;
  /** Reasoning-модель — поддерживает reasoning_effort minimal/low/medium/high. */
  reasoning: boolean;
}

export const MODEL_OPTIONS: ModelOption[] = [
  // Anthropic
  {
    id: MODELS.CLAUDE_SONNET,
    label: "Claude Sonnet 4.5",
    vendor: "Anthropic",
    multimodal: true,
    tier: "balanced",
    reasoning: false,
    description: "Универсальная сильная модель. Хорошо держит формат и инструкции.",
  },
  {
    id: MODELS.CLAUDE_OPUS,
    label: "Claude Opus 4.1",
    vendor: "Anthropic",
    multimodal: true,
    tier: "deep",
    reasoning: false,
    description: "Самая способная модель Anthropic. Дольше и дороже.",
  },
  // OpenAI
  {
    id: MODELS.GPT_5,
    label: "GPT-5",
    vendor: "OpenAI",
    multimodal: true,
    tier: "deep",
    reasoning: true,
    description: "Флагман OpenAI с extended thinking. reasoning_effort: minimal..high.",
  },
  {
    id: MODELS.GPT_5_MINI,
    label: "GPT-5 mini",
    vendor: "OpenAI",
    multimodal: true,
    tier: "balanced",
    reasoning: true,
    description: "Лёгкая reasoning-модель OpenAI.",
  },
  {
    id: MODELS.GPT_4O,
    label: "GPT-4o",
    vendor: "OpenAI",
    multimodal: true,
    tier: "fast",
    reasoning: false,
    description: "Быстрый универсал, без reasoning.",
  },
  // Google
  {
    id: MODELS.GEMINI_PRO,
    label: "Gemini 2.5 Pro",
    vendor: "Google",
    multimodal: true,
    tier: "deep",
    reasoning: false,
    description: "Большой контекст, хорошо с длинными документами и кодом.",
  },
  {
    id: MODELS.GEMINI_FLASH,
    label: "Gemini 2.5 Flash",
    vendor: "Google",
    multimodal: true,
    tier: "fast",
    reasoning: false,
    description: "Быстрый Gemini для коротких задач.",
  },
  // xAI: временно отключены — AIMLAPI возвращает 500 на все варианты Grok.
  // Вернуть, когда найдём корректный формат запроса.
  // DeepSeek
  {
    id: MODELS.DEEPSEEK_R1,
    label: "DeepSeek R1",
    vendor: "DeepSeek",
    multimodal: false,
    tier: "deep",
    reasoning: true,
    description: "Reasoning-модель DeepSeek с видимыми рассуждениями.",
  },
  {
    id: MODELS.DEEPSEEK_V3,
    label: "DeepSeek V3.1",
    vendor: "DeepSeek",
    multimodal: false,
    tier: "balanced",
    reasoning: false,
    description: "Сильный универсал, открытые веса.",
  },
  // Perplexity
  {
    id: MODELS.PERPLEXITY_SONAR,
    label: "Perplexity Sonar Pro",
    vendor: "Perplexity",
    multimodal: false,
    tier: "balanced",
    reasoning: false,
    description: "С поиском по интернету. Используется при ресёрч-задачах.",
  },
  // Image generation
  {
    id: MODELS.IMAGEN_4,
    label: "Imagen 4",
    vendor: "Google",
    multimodal: false,
    tier: "balanced",
    reasoning: false,
    description: "Генерация изображений. Хорошо работает с текстом внутри картинки.",
  },
  {
    id: MODELS.IMAGEN_4_FAST,
    label: "Imagen 4 Fast",
    vendor: "Google",
    multimodal: false,
    tier: "fast",
    reasoning: false,
    description: "Быстрая версия Imagen 4. Меньше времени, чуть проще картинка.",
  },
  {
    id: MODELS.FLUX_PRO,
    label: "Flux Pro 1.1",
    vendor: "BlackForestLabs",
    multimodal: false,
    tier: "balanced",
    reasoning: false,
    description: "Реалистичные сцены, лица, типографика. Эталон 2025.",
  },
  {
    id: MODELS.DALL_E_3,
    label: "DALL-E 3",
    vendor: "OpenAI",
    multimodal: false,
    tier: "balanced",
    reasoning: false,
    description: "Сильна в композиции. Слабее в реализме.",
  },
];

/** Модели, которые работают через /v1/images/generations (а не chat/completions). */
const IMAGE_MODEL_IDS = new Set<string>([
  MODELS.IMAGEN_4,
  MODELS.IMAGEN_4_FAST,
  MODELS.FLUX_PRO,
  MODELS.DALL_E_3,
]);

export function isImageModel(id: string): boolean {
  return IMAGE_MODEL_IDS.has(id);
}

export function getModelOption(id: string): ModelOption {
  return MODEL_OPTIONS.find((m) => m.id === id) ?? MODEL_OPTIONS[0];
}

export function isKnownModel(id: string): boolean {
  return MODEL_OPTIONS.some((m) => m.id === id);
}

// ─── Категории задач ─────────────────────────────────────────────────
//
// Это и классификация роутера, и набор пресетов в селекторе модели.
// За каждой категорией закреплены: модель, reasoning_effort, max_tokens —
// настраивается в /admin/chat (таблица chat_category_routing).

export type TaskCategory = "quick" | "research" | "code" | "analyze" | "strategy" | "image";

export const TASK_CATEGORIES: TaskCategory[] = [
  "quick",
  "research",
  "code",
  "analyze",
  "strategy",
  "image",
];

export interface CategoryMeta {
  id: TaskCategory;
  label: string;
  icon: string;
  hint: string;
}

export const CATEGORY_META: Record<TaskCategory, CategoryMeta> = {
  quick: { id: "quick", label: "Быстрый ответ", icon: "💬", hint: "Короткий факт или уточнение." },
  research: { id: "research", label: "Ресёрч", icon: "🔍", hint: "Поиск, факты, ссылки, источники." },
  code: { id: "code", label: "Код", icon: "💻", hint: "Написать, починить, объяснить код." },
  analyze: { id: "analyze", label: "Анализ", icon: "📊", hint: "Разобрать данные, документ, логи." },
  strategy: { id: "strategy", label: "Стратегия", icon: "🎯", hint: "Продумать варианты и решения." },
  image: { id: "image", label: "Картинка", icon: "🎨", hint: "Сгенерировать изображение по описанию." },
};

export function isTaskCategory(v: unknown): v is TaskCategory {
  return (
    v === "quick" ||
    v === "research" ||
    v === "code" ||
    v === "analyze" ||
    v === "strategy" ||
    v === "image"
  );
}

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";
export const REASONING_EFFORTS: ReasoningEffort[] = ["minimal", "low", "medium", "high"];
export function isReasoningEffort(v: unknown): v is ReasoningEffort {
  return v === "minimal" || v === "low" || v === "medium" || v === "high";
}

/** Дефолтная маршрутизация — используется, если в БД нет записей. */
export interface CategoryRoute {
  category: TaskCategory;
  model: string;
  reasoning_effort: ReasoningEffort | null;
  max_tokens: number;
}

export const DEFAULT_CATEGORY_ROUTES: CategoryRoute[] = [
  { category: "quick",    model: MODELS.GEMINI_FLASH,   reasoning_effort: null,   max_tokens: 2000 },
  { category: "research", model: MODELS.PERPLEXITY_SONAR, reasoning_effort: null, max_tokens: 4000 },
  { category: "code",     model: MODELS.CLAUDE_OPUS,    reasoning_effort: null,   max_tokens: 8000 },
  { category: "analyze",  model: MODELS.GEMINI_PRO,     reasoning_effort: null,   max_tokens: 8000 },
  { category: "strategy", model: MODELS.GPT_5,          reasoning_effort: "high", max_tokens: 8000 },
  { category: "image",    model: MODELS.IMAGEN_4,       reasoning_effort: null,   max_tokens: 0 },
];

// ─── Markdown-блоки ──────────────────────────────────────────────────

export interface EnabledBlocks {
  headings: boolean;
  emphasis: boolean;
  lists: boolean;
  tables: boolean;
  code: boolean;
  quotes: boolean;
  hr: boolean;
  links: boolean;
  images: boolean;
}

export const DEFAULT_ENABLED_BLOCKS: EnabledBlocks = {
  headings: true,
  emphasis: true,
  lists: true,
  tables: true,
  code: true,
  quotes: true,
  hr: true,
  links: true,
  images: true,
};

export const ENABLED_BLOCKS_META: Array<{
  key: keyof EnabledBlocks;
  label: string;
  description: string;
}> = [
  { key: "headings", label: "Заголовки ## / ###", description: "Разделы внутри длинного ответа." },
  { key: "emphasis", label: "Жирный / курсив / inline-код", description: "**жирный**, *курсив*, `code`." },
  { key: "lists", label: "Списки", description: "Маркированные и нумерованные." },
  { key: "tables", label: "Таблицы GFM", description: "| col | col | — главный кейс из ТЗ." },
  { key: "code", label: "Блоки кода ```lang```", description: "Моноширинный блок с языком." },
  { key: "quotes", label: "Цитаты (>)", description: "Блок цитаты для выделения." },
  { key: "hr", label: "Разделитель ---", description: "Горизонтальная линия между разделами." },
  { key: "links", label: "Ссылки [текст](url)", description: "Кликабельные ссылки." },
  { key: "images", label: "Картинки по URL", description: "![alt](https://…) — модель может встроить картинку." },
];
