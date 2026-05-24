/**
 * Синхронизация каталога Apify Store → наша таблица scraper_catalog.
 *
 * Зачем: на UI модуля /scraper показываем «что я умею» — карточки с примерами.
 * Откуда берём идеи: публичный Apify Store содержит тысячи специализированных
 * скрейперов (Instagram, hh.ru, Авито, Google Maps, …). Они нам не нужны
 * как исполнители (мы запускаем свой runner и пишем код через LLM), но они
 * идеальный источник идей для каталога.
 *
 * Алгоритм sync:
 *  1. GET /v2/store?sortBy=popularity — топ актеров по популярности.
 *  2. Фильтруем мусор: ≥ `minUsers` пользователей, не deprecated.
 *  3. Батчами по 10 — LLM переводит и обогащает (title_ru, description_ru,
 *     category_ru, target_sites, 2-3 example_prompts).
 *  4. UPSERT в scraper_catalog.
 *
 * Дешёвый идемпотентный процесс: повторный sync обновляет last_synced_at,
 * не создаёт дубликатов.
 */

import { getDb, ensureSchema } from "@/lib/db";
import { chat, MODELS, AIError } from "@/lib/ai";
import { logServerError } from "@/lib/logger";

const APIFY_BASE = "https://api.apify.com/v2";
const BATCH_SIZE = 10;

export interface SyncResult {
  fetched: number;
  filtered: number;
  upserted: number;
  failed: number;
  errors: string[];
}

interface ApifyStoreItem {
  id: string;
  name: string;
  username: string;
  title: string;
  description?: string;
  pictureUrl?: string;
  categories?: string[];
  stats?: {
    totalUsers?: number;
    totalRuns?: number;
    totalUsers30Days?: number;
  };
  isPublic?: boolean;
  isDeprecated?: boolean;
}

interface EnrichedItem {
  title_ru: string;
  description_ru: string;
  category_ru: string;
  target_sites: string[];
  example_prompts: Array<{ label: string; prompt: string }>;
}

export interface CatalogRow {
  apify_actor_id: string;
  actor_name: string;
  canonical: string;
  title: string;
  title_ru: string | null;
  description: string | null;
  description_ru: string | null;
  category: string | null;
  category_ru: string | null;
  target_sites: string | null;
  example_prompts: string | null;
  apify_url: string;
  stats_users: number | null;
  stats_total_runs: number | null;
  last_synced_at: string;
  created_at: string;
}

export async function syncCatalog(
  opts: { limit?: number; minUsers?: number } = {},
): Promise<SyncResult> {
  const limit = Math.min(opts.limit ?? 100, 500);
  const minUsers = opts.minUsers ?? 100;

  const result: SyncResult = {
    fetched: 0,
    filtered: 0,
    upserted: 0,
    failed: 0,
    errors: [],
  };

  await ensureSchema();
  const db = getDb();

  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN не задан");

  // 1. Тянем топ-актеров. У Apify Store API лимит 1000 за раз — берём с запасом.
  const fetchLimit = Math.min(limit * 3, 1000);
  const storeUrl = `${APIFY_BASE}/store?limit=${fetchLimit}&sortBy=popularity&token=${token}`;
  const storeResp = await fetch(storeUrl);
  if (!storeResp.ok) {
    const body = await storeResp.text().catch(() => "");
    throw new Error(
      `Apify Store API: ${storeResp.status} ${storeResp.statusText} ${body.slice(0, 200)}`,
    );
  }
  const storeJson = (await storeResp.json()) as {
    data: { items: ApifyStoreItem[] };
  };
  const allItems = storeJson.data.items ?? [];
  result.fetched = allItems.length;

  // 2. Фильтр мусора + cap по limit.
  const filtered = allItems
    .filter(
      (a) =>
        a.isPublic !== false &&
        !a.isDeprecated &&
        (a.stats?.totalUsers ?? 0) >= minUsers &&
        a.title &&
        a.description,
    )
    .slice(0, limit);
  result.filtered = filtered.length;

  // 3. Батчами по BATCH_SIZE — LLM-обогащение.
  for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
    const batch = filtered.slice(i, i + BATCH_SIZE);
    let enriched: Record<string, EnrichedItem>;
    try {
      enriched = await enrichBatch(batch);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      result.errors.push(`batch ${i}: ${errMsg}`);
      result.failed += batch.length;
      await logServerError(err, "/scraper/catalog:enrichBatch", {
        batchStart: i,
        batchSize: batch.length,
      });
      continue;
    }

    for (const a of batch) {
      const meta = enriched[a.id];
      if (!meta) {
        result.failed += 1;
        continue;
      }
      try {
        await upsert(db, a, meta);
        result.upserted += 1;
      } catch (err) {
        result.failed += 1;
        result.errors.push(
          `upsert ${a.username}/${a.name}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  return result;
}

async function enrichBatch(
  batch: ApifyStoreItem[],
): Promise<Record<string, EnrichedItem>> {
  // Готовим компактный JSON для модели — только нужные поля.
  const compact = batch.map((a) => ({
    id: a.id,
    title: a.title,
    name: a.name,
    description: (a.description ?? "").slice(0, 800),
    categories: a.categories ?? [],
  }));

  const systemPrompt = `
Ты — редактор каталога скрейперов в продукте AIBOOSTER.
На вход получаешь массив актеров из Apify Store. Для каждого верни обогащённую запись.

Требования к выходу:
- "title_ru": короткое русское название, 2-5 слов, без слова "скрейпер" (например: "Вакансии hh.ru", "Товары Wildberries").
- "description_ru": 1-2 предложения на русском о том, что собирает и для кого полезно. Без воды.
- "category_ru": одна из категорий → "Соцсети", "Маркетплейсы", "Недвижимость",
  "Вакансии", "Новости и медиа", "Поисковики", "Путешествия", "Карты и места",
  "Бизнес-данные", "Видео и стриминг", "Финансы", "Государство", "Другое".
- "target_sites": массив доменов, с которыми работает (например, ["hh.ru"], ["instagram.com"]).
- "example_prompts": ровно 2 примера запросов на русском в формате {label, prompt}.
  label — что собрать (3-6 слов), prompt — полный запрос, который пользователь МОГ БЫ ввести
  в форму нашего скрейпера. Конкретный, с примерным URL или категорией.

Формат ответа (СТРОГО, без markdown, без пояснений):
{
  "<actor_id>": { "title_ru": "...", "description_ru": "...", "category_ru": "...", "target_sites": [...], "example_prompts": [{"label": "...", "prompt": "..."}, {"label": "...", "prompt": "..."}] },
  ...
}
`.trim();

  const userPrompt = `Актеры для обогащения:\n${JSON.stringify(compact, null, 2)}`;

  const r = await chat({
    model: MODELS.CLAUDE_SONNET,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4000,
    response_format: { type: "json_object" },
  });

  const raw = r.choices[0]?.message?.content;
  if (!raw) throw new AIError("LLM вернула пустой ответ при enrich", 502);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const stripped = raw
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    parsed = JSON.parse(stripped);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new AIError("LLM вернула не объект", 502);
  }
  return parsed as Record<string, EnrichedItem>;
}

async function upsert(
  db: ReturnType<typeof getDb>,
  a: ApifyStoreItem,
  meta: EnrichedItem,
) {
  const canonical = `${a.username}~${a.name}`;
  const apifyUrl = `https://apify.com/${a.username}/${a.name}`;
  const targetSites = JSON.stringify(meta.target_sites ?? []);
  const examplePrompts = JSON.stringify(meta.example_prompts ?? []);
  const primaryCategory = a.categories?.[0] ?? null;

  await db.execute({
    sql: `INSERT INTO scraper_catalog
            (apify_actor_id, actor_name, canonical, title, title_ru,
             description, description_ru, category, category_ru,
             target_sites, example_prompts, apify_url,
             stats_users, stats_total_runs, last_synced_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(apify_actor_id) DO UPDATE SET
            actor_name = excluded.actor_name,
            canonical = excluded.canonical,
            title = excluded.title,
            title_ru = excluded.title_ru,
            description = excluded.description,
            description_ru = excluded.description_ru,
            category = excluded.category,
            category_ru = excluded.category_ru,
            target_sites = excluded.target_sites,
            example_prompts = excluded.example_prompts,
            apify_url = excluded.apify_url,
            stats_users = excluded.stats_users,
            stats_total_runs = excluded.stats_total_runs,
            last_synced_at = datetime('now')`,
    args: [
      a.id,
      a.name,
      canonical,
      a.title,
      meta.title_ru ?? null,
      a.description ?? null,
      meta.description_ru ?? null,
      primaryCategory,
      meta.category_ru ?? null,
      targetSites,
      examplePrompts,
      apifyUrl,
      a.stats?.totalUsers ?? null,
      a.stats?.totalRuns ?? null,
    ],
  });
}

export async function listCatalog(opts: {
  category?: string;
  limit?: number;
}): Promise<CatalogRow[]> {
  await ensureSchema();
  const db = getDb();
  const limit = Math.min(opts.limit ?? 100, 500);
  const args: (string | number)[] = [];
  let where = "";
  if (opts.category) {
    where = "WHERE category_ru = ?";
    args.push(opts.category);
  }
  args.push(limit);

  const res = await db.execute({
    sql: `SELECT apify_actor_id, actor_name, canonical, title, title_ru,
                 description, description_ru, category, category_ru,
                 target_sites, example_prompts, apify_url,
                 stats_users, stats_total_runs, last_synced_at, created_at
          FROM scraper_catalog
          ${where}
          ORDER BY stats_users DESC, last_synced_at DESC
          LIMIT ?`,
    args,
  });
  return res.rows as unknown as CatalogRow[];
}

export async function listCategories(): Promise<
  Array<{ category_ru: string; count: number }>
> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute(
    `SELECT category_ru, COUNT(*) as count
     FROM scraper_catalog
     WHERE category_ru IS NOT NULL
     GROUP BY category_ru
     ORDER BY count DESC`,
  );
  return res.rows.map((r) => ({
    category_ru: (r as unknown as { category_ru: string }).category_ru,
    count: Number((r as unknown as { count: number | string }).count),
  }));
}
