// Чистые константы и типы для клиентской части модуля чата.
// Тут НЕ должно быть node:crypto и обращений к БД — этот файл тянется в браузер.

import { MODELS } from "./ai";

export interface ModelOption {
  id: string;
  label: string;
  vendor: string;
  multimodal: boolean;
  description: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: MODELS.CLAUDE_SONNET,
    label: "Claude Sonnet 4.5",
    vendor: "Anthropic",
    multimodal: true,
    description: "Универсальный дефолт. Хорошо держит формат и инструкции.",
  },
  {
    id: MODELS.CLAUDE_OPUS,
    label: "Claude Opus 4.1",
    vendor: "Anthropic",
    multimodal: true,
    description: "Самая способная модель Anthropic. Дольше и дороже.",
  },
  {
    id: MODELS.GPT_5,
    label: "GPT-5",
    vendor: "OpenAI",
    multimodal: true,
    description: "Reasoning-модель OpenAI. Думает дольше, ответы точнее.",
  },
  {
    id: MODELS.GPT_5_MINI,
    label: "GPT-5 mini",
    vendor: "OpenAI",
    multimodal: true,
    description: "Быстрая reasoning-модель.",
  },
  {
    id: MODELS.GPT_4O,
    label: "GPT-4o",
    vendor: "OpenAI",
    multimodal: true,
    description: "Быстрый универсал, без reasoning.",
  },
  {
    id: MODELS.GEMINI_PRO,
    label: "Gemini 2.5 Pro",
    vendor: "Google",
    multimodal: true,
    description: "Большой контекст, хорошо с длинными документами.",
  },
  {
    id: MODELS.GEMINI_FLASH,
    label: "Gemini 2.5 Flash",
    vendor: "Google",
    multimodal: true,
    description: "Быстрый Gemini для коротких задач.",
  },
  {
    id: MODELS.PERPLEXITY_SONAR,
    label: "Perplexity Sonar Pro",
    vendor: "Perplexity",
    multimodal: false,
    description: "С поиском по интернету. Текстовые запросы.",
  },
];

export function getModelOption(id: string): ModelOption {
  return MODEL_OPTIONS.find((m) => m.id === id) ?? MODEL_OPTIONS[0];
}

export function isKnownModel(id: string): boolean {
  return MODEL_OPTIONS.some((m) => m.id === id);
}

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
