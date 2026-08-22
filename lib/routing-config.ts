// CRUD для таблицы chat_category_routing — маршрутизация (категория → модель).
//
// При первом обращении seedRoutesIfEmpty() кладёт дефолты из DEFAULT_CATEGORY_ROUTES.
// Дальше — единственный источник правды для роутера и пресетов в селекторе.

import { getDb, ensureSchema } from "./db";
import {
  DEFAULT_CATEGORY_ROUTES,
  TASK_CATEGORIES,
  isReasoningEffort,
  isTaskCategory,
  type CategoryRoute,
  type TaskCategory,
  type ReasoningEffort,
} from "./chat-client";
import { isKnownModel } from "./chat-client";

interface RoutingRow {
  category: string;
  model: string;
  reasoning_effort: string | null;
  max_tokens: number;
  updated_at: string;
}

function rowToRoute(r: RoutingRow): CategoryRoute | null {
  if (!isTaskCategory(r.category)) return null;
  const re = r.reasoning_effort && isReasoningEffort(r.reasoning_effort) ? r.reasoning_effort : null;
  return {
    category: r.category,
    model: r.model,
    reasoning_effort: re,
    max_tokens: r.max_tokens,
  };
}

let _seeded = false;

/** Дозаполнить таблицу дефолтами для категорий, которых ещё нет в БД.
 *  Идемпотентно. Плюс — однократные апгрейды старых дефолтов на новые
 *  (policy «качество > экономия»). */
async function seedRoutesIfEmpty(): Promise<void> {
  if (_seeded) return;
  await ensureSchema();
  const db = getDb();
  const existing = await db.execute(`SELECT category, model, max_tokens FROM chat_category_routing`);
  const haveRows = existing.rows as unknown as Array<{ category: string; model: string; max_tokens: number }>;
  const have = new Set(haveRows.map((r) => r.category));
  const now = new Date().toISOString();
  for (const r of DEFAULT_CATEGORY_ROUTES) {
    if (have.has(r.category)) continue;
    await db.execute({
      sql: `INSERT INTO chat_category_routing (category, model, reasoning_effort, max_tokens, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [r.category, r.model, r.reasoning_effort, r.max_tokens, now, now],
    });
  }

  // Однократный апгрейд: quick раньше был gemini-2.5-flash, теперь
  // claude-sonnet-4-5. Переписываем только если запись выглядит как
  // нетронутый дефолт (max_tokens по умолчанию). Если пользователь сам
  // выбрал Flash — оставим его.
  const oldQuick = haveRows.find((r) => r.category === "quick");
  if (oldQuick && oldQuick.model === "gemini-2.5-flash" && oldQuick.max_tokens <= 2500) {
    await db.execute({
      sql: `UPDATE chat_category_routing
            SET model = ?, max_tokens = 2000, updated_at = ?
            WHERE category = 'quick'`,
      args: ["claude-sonnet-4-5", now],
    });
  }

  // Однократный апгрейд лимита для research: было 4000, теперь даём
  // 6000 — длинные ответы со структурой (таблицы/заголовки) часто в 4k
  // обрезались. Трогаем только если ровно прежний дефолт.
  const oldResearch = haveRows.find((r) => r.category === "research");
  if (oldResearch && oldResearch.max_tokens === 4000) {
    await db.execute({
      sql: `UPDATE chat_category_routing
            SET max_tokens = 6000, updated_at = ?
            WHERE category = 'research'`,
      args: [now],
    });
  }

  _seeded = true;
}

/** Все маршруты в порядке TASK_CATEGORIES. Недостающие — из дефолтов. */
export async function listRoutes(): Promise<CategoryRoute[]> {
  await seedRoutesIfEmpty();
  const db = getDb();
  const res = await db.execute(
    `SELECT category, model, reasoning_effort, max_tokens, updated_at FROM chat_category_routing`,
  );
  const byCat = new Map<TaskCategory, CategoryRoute>();
  for (const row of res.rows as unknown as RoutingRow[]) {
    const route = rowToRoute(row);
    if (route) byCat.set(route.category, route);
  }
  const out: CategoryRoute[] = [];
  for (const cat of TASK_CATEGORIES) {
    const fromDb = byCat.get(cat);
    if (fromDb) {
      out.push(fromDb);
    } else {
      const fallback = DEFAULT_CATEGORY_ROUTES.find((r) => r.category === cat);
      if (fallback) out.push(fallback);
    }
  }
  return out;
}

/** Получить маршрут конкретной категории. */
export async function getRoute(category: TaskCategory): Promise<CategoryRoute> {
  const all = await listRoutes();
  return all.find((r) => r.category === category) ?? DEFAULT_CATEGORY_ROUTES[0];
}

export interface RouteInput {
  category: TaskCategory;
  model: string;
  reasoning_effort: ReasoningEffort | null;
  max_tokens: number;
}

/** Перезаписать все 5 маршрутов одним батчем. */
export async function updateRoutes(routes: RouteInput[]): Promise<void> {
  await seedRoutesIfEmpty();
  const db = getDb();
  const now = new Date().toISOString();
  for (const r of routes) {
    if (!isTaskCategory(r.category)) continue;
    if (!isKnownModel(r.model)) continue;
    const re = r.reasoning_effort && isReasoningEffort(r.reasoning_effort) ? r.reasoning_effort : null;
    const maxT = Number.isFinite(r.max_tokens) && r.max_tokens > 0 ? Math.min(r.max_tokens, 32000) : 4000;
    await db.execute({
      sql: `INSERT INTO chat_category_routing (category, model, reasoning_effort, max_tokens, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(category) DO UPDATE SET
              model = excluded.model,
              reasoning_effort = excluded.reasoning_effort,
              max_tokens = excluded.max_tokens,
              updated_at = excluded.updated_at`,
      args: [r.category, r.model, re, maxT, now, now],
    });
  }
}
