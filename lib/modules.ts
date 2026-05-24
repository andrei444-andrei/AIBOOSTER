/**
 * Реестр модулей продукта — единая точка для навигации.
 *
 * Каждый новый модуль добавляется сюда. Поле `pinned` управляет
 * присутствием в боковой навигации; остальные могут жить «вне меню».
 *
 * Это TS-данные, не БД — добавление модуля = маленькая правка кода.
 * Регистрация в одном месте: знают и Sidebar, и любые «индексные»
 * экраны, которые в будущем захотят перечислить модули программно.
 */

export type ModuleSection = "main" | "service";

export interface ModuleEntry {
  slug: string;
  title: string;
  href: string;
  description?: string;
  /** Появляется в Sidebar. */
  pinned?: boolean;
  /** Группа в Sidebar; "main" — наверху, "service" — внизу под разделителем. */
  section: ModuleSection;
  /** Короткий значок (emoji или 1–2 символа). Опционально. */
  icon?: string;
  /** Защищён ADMIN_TOKEN — Sidebar добавит маленькую отметку. */
  requiresAdminToken?: boolean;
}

export const MODULES: ModuleEntry[] = [
  {
    slug: "home",
    title: "Главная",
    href: "/",
    description: "Старт и обзор продукта.",
    pinned: true,
    section: "main",
    icon: "·",
  },
  {
    slug: "scraper",
    title: "AI Scraper",
    href: "/scraper",
    description: "Скажи задачу — AI напишет код, соберёт данные с веба, отдаст отчёт.",
    pinned: true,
    section: "main",
    icon: "◉",
  },
  {
    slug: "ux-kit",
    title: "UX Kit",
    href: "/ux",
    description: "Палитра, компоненты, токены.",
    pinned: true,
    section: "service",
    icon: "◐",
  },
  {
    slug: "admin",
    title: "Админка",
    href: "/admin",
    description: "Структура БД, логи, прогоны тестов.",
    pinned: true,
    section: "service",
    icon: "⌘",
    requiresAdminToken: true,
  },
];

export function getPinnedModules(): ModuleEntry[] {
  return MODULES.filter((m) => m.pinned);
}

/** Активен ли модуль для данного pathname. */
export function isModuleActive(m: ModuleEntry, pathname: string): boolean {
  if (m.href === "/") return pathname === "/";
  return pathname === m.href || pathname.startsWith(m.href + "/");
}
