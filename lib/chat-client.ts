// Чистые константы и типы для клиентской части модуля чата.
// Тут НЕ должно быть node:crypto и обращений к БД — этот файл тянется в браузер.

import { MODELS } from "./ai";

// ─── Режимы ──────────────────────────────────────────────────────────
//
// Обычный — быстрый качественный ответ за 5–10 сек: лёгкие модели,
// без расширенного reasoning. Pro — глубже и дольше: тяжёлые модели,
// reasoning_effort high, больше max_tokens.

export type ChatMode = "normal" | "pro";
export const DEFAULT_MODE: ChatMode = "normal";

export interface ChatModeOption {
  id: ChatMode;
  label: string;
  description: string;
  hint: string;
}

export const MODE_OPTIONS: ChatModeOption[] = [
  {
    id: "normal",
    label: "Обычный",
    description: "Быстрый качественный ответ за 5–10 сек.",
    hint: "Sonnet, GPT-4o, Flash — без расширенного reasoning.",
  },
  {
    id: "pro",
    label: "Pro",
    description: "Глубже и дольше — для сложных задач.",
    hint: "Opus, GPT-5, Gemini Pro — extended thinking, больше токенов.",
  },
];

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
  /** В каких режимах модель доступна авто-роутером. Override игнорирует это. */
  availableInModes: ChatMode[];
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: MODELS.CLAUDE_SONNET,
    label: "Claude Sonnet 4.5",
    vendor: "Anthropic",
    multimodal: true,
    tier: "balanced",
    availableInModes: ["normal", "pro"],
    description: "Универсальный дефолт. Хорошо держит формат и инструкции.",
  },
  {
    id: MODELS.CLAUDE_OPUS,
    label: "Claude Opus 4.1",
    vendor: "Anthropic",
    multimodal: true,
    tier: "deep",
    availableInModes: ["pro"],
    description: "Самая способная модель Anthropic. Дольше и дороже.",
  },
  {
    id: MODELS.GPT_5,
    label: "GPT-5",
    vendor: "OpenAI",
    multimodal: true,
    tier: "deep",
    availableInModes: ["pro"],
    description: "Reasoning-модель OpenAI. Думает дольше, ответы точнее.",
  },
  {
    id: MODELS.GPT_5_MINI,
    label: "GPT-5 mini",
    vendor: "OpenAI",
    multimodal: true,
    tier: "balanced",
    availableInModes: ["normal", "pro"],
    description: "Быстрая reasoning-модель.",
  },
  {
    id: MODELS.GPT_4O,
    label: "GPT-4o",
    vendor: "OpenAI",
    multimodal: true,
    tier: "fast",
    availableInModes: ["normal"],
    description: "Быстрый универсал, без reasoning.",
  },
  {
    id: MODELS.GEMINI_PRO,
    label: "Gemini 2.5 Pro",
    vendor: "Google",
    multimodal: true,
    tier: "deep",
    availableInModes: ["pro"],
    description: "Большой контекст, хорошо с длинными документами.",
  },
  {
    id: MODELS.GEMINI_FLASH,
    label: "Gemini 2.5 Flash",
    vendor: "Google",
    multimodal: true,
    tier: "fast",
    availableInModes: ["normal"],
    description: "Быстрый Gemini для коротких задач.",
  },
  {
    id: MODELS.PERPLEXITY_SONAR,
    label: "Perplexity Sonar Pro",
    vendor: "Perplexity",
    multimodal: false,
    tier: "balanced",
    availableInModes: ["normal", "pro"],
    description: "С поиском по интернету. Текстовые запросы.",
  },
];

export function getModelOption(id: string): ModelOption {
  return MODEL_OPTIONS.find((m) => m.id === id) ?? MODEL_OPTIONS[0];
}

export function isKnownModel(id: string): boolean {
  return MODEL_OPTIONS.some((m) => m.id === id);
}

export function isValidMode(v: unknown): v is ChatMode {
  return v === "normal" || v === "pro";
}

// ─── Категории задач (для роутера) ───────────────────────────────────

export type TaskCategory = "quick" | "research" | "code" | "analyze" | "strategy";

export interface CategoryMeta {
  id: TaskCategory;
  label: string;
  hint: string;
}

export const CATEGORY_META: Record<TaskCategory, CategoryMeta> = {
  quick: { id: "quick", label: "Быстрый ответ", hint: "Короткий факт или уточнение." },
  research: { id: "research", label: "Ресёрч", hint: "Сбор фактов, сравнение, ссылки." },
  code: { id: "code", label: "Код", hint: "Написать, починить, объяснить код." },
  analyze: { id: "analyze", label: "Анализ", hint: "Разобрать данные, документ, логи." },
  strategy: { id: "strategy", label: "Стратегия", hint: "Продумать варианты и решения." },
};

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
