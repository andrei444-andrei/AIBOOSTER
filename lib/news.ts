// CRUD-операции над таблицами news_*: news_sources, news_items, news_feedback,
// interest_profile. Имена таблиц/колонок — в lib/schema.ts.
//
// Этот модуль не делает сетевых вызовов и не знает про aimlapi/Apify — только
// чистая работа с БД. Pipeline-логика (фетч, валидация) лежит в
// lib/news-pipeline.ts; она использует функции отсюда.

import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "./db";
import type { InterestProfile, InterestTopic } from "./news-prompt";

export type SourceKind = "telegram" | "rss";

export interface NewsSourceRow {
  id: string;
  kind: SourceKind;
  url: string;
  name: string;
  fetch_interval_minutes: number;
  last_fetched_at: string | null;
  locked_until: string | null;
  apify_run_id: string | null;
  apify_run_status: string | null;
  apify_run_started_at: string | null;
  active: number;
  created_at: string;
}

export type NewsItemStatus = "pending" | "validated" | "failed";
export type NewsItemVerdict = "show" | "borderline" | "skip";

export interface NewsItemRow {
  id: string;
  source_id: string;
  external_id: string;
  url: string | null;
  title: string | null;
  body: string | null;
  published_at: string | null;
  raw_meta: string | null;
  status: NewsItemStatus;
  validation_input: string | null;
  validation_output_json: string | null;
  validation_error: string | null;
  model_used: string | null;
  summary: string | null;
  value_explanation: string | null;
  matched_topics_json: string | null;
  relevance: number | null;
  verdict: NewsItemVerdict | null;
  reasoning: string | null;
  validated_at: string | null;
  created_at: string;
}

export interface NewsFeedbackRow {
  id: string;
  item_id: string;
  signal: "like" | "dislike" | "hide";
  reason_chip: string | null;
  custom_text: string | null;
  created_at: string;
}

export interface InterestProfileRow {
  id: string;
  worldview_context: string;
  topics_json: string;
  updated_at: string;
}

// ---------- defaults / seeding ----------

const PROFILE_ID = "me";

export const DEFAULT_WORLDVIEW =
  "Я строю AIBOOSTER — платформу AI-инструментов, ускоряющих рутинные задачи. " +
  "Ищу действенные инсайты, конкретные приёмы и инструменты, которые можно " +
  "применить в продукте или операционке. Не нужны общие новости, инфоповоды, " +
  "хайп без сути.";

export const DEFAULT_TOPICS: InterestTopic[] = [
  {
    name: "AI-агенты и инструменты",
    description:
      "Новые агентные системы, фреймворки, протоколы (MCP), кейсы реального использования агентов в продакшене",
    what_bores_me: "теоретические рассуждения про AGI, общий хайп без технических деталей",
    priority: "high",
    status: "active",
  },
  {
    name: "Монетизация SaaS и приложений",
    description:
      "Конкретные кейсы pricing-стратегий, paywall-экспериментов, конверсии бесплатных пользователей в платных, разборы с цифрами",
    what_bores_me: "общие статьи 'как заработать на приложении', success-stories без метрик",
    priority: "high",
    status: "active",
  },
  {
    name: "Web-подписки (Stripe, Paddle, Lemon)",
    description:
      "Технические и продуктовые приёмы вокруг подписок: dunning, churn, plans/limits, A/B тесты пейволлов",
    what_bores_me: "промо-статьи самих платформ",
    priority: "medium",
    status: "active",
  },
  {
    name: "Инвестиционные стратегии",
    description:
      "Долгосрочные стратегии для IT-предпринимателя: диверсификация, налоги для нерезидентов, конкретные инструменты",
    what_bores_me: "крипто-спекуляции, дневной трейдинг, прогнозы цен",
    priority: "medium",
    status: "active",
  },
  {
    name: "Claude / OpenAI / API",
    description:
      "Обновления моделей, новые возможности API (caching, structured outputs, computer use), best practices для prompt-engineering",
    what_bores_me: "общие обзоры моделей без технической глубины",
    priority: "high",
    status: "active",
  },
];

export const DEFAULT_SOURCES: Array<{
  kind: SourceKind;
  url: string;
  name: string;
}> = [
  // RSS первым: на холодном старте он отрабатывает в один tick (быстрый
  // fetch + валидация), пользователь видит ленту в первые 10 минут.
  // Telegram требует двух tick'ов из-за async-Apify, поэтому ставим его второй.
  {
    kind: "rss",
    url: "https://news.ycombinator.com/rss",
    name: "Hacker News",
  },
  {
    kind: "telegram",
    url: "https://t.me/seeallochnaya",
    name: "Сиолошная",
  },
];

// ---------- profile ----------

export async function getActiveProfile(): Promise<InterestProfile> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT worldview_context, topics_json FROM interest_profile WHERE id = ?`,
    args: [PROFILE_ID],
  });
  const row = res.rows[0];
  if (!row) {
    return { worldview_context: "", topics: [] };
  }
  return {
    worldview_context: String(row.worldview_context ?? ""),
    topics: parseTopics(String(row.topics_json ?? "[]")),
  };
}

export async function upsertProfile(profile: InterestProfile): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO interest_profile (id, worldview_context, topics_json, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            worldview_context = excluded.worldview_context,
            topics_json = excluded.topics_json,
            updated_at = excluded.updated_at`,
    args: [
      PROFILE_ID,
      profile.worldview_context ?? "",
      JSON.stringify(profile.topics ?? []),
      now,
    ],
  });
}

function parseTopics(s: string): InterestTopic[] {
  try {
    const v = JSON.parse(s);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is InterestTopic => x && typeof x === "object" && typeof (x as InterestTopic).name === "string");
  } catch {
    return [];
  }
}

// Сидим дефолты, только если профиля ещё нет. Возвращаем true если что-то
// вставили (для диагностики read-only токена в pipeline).
export async function seedProfileIfEmpty(): Promise<boolean> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT id FROM interest_profile WHERE id = ?`,
    args: [PROFILE_ID],
  });
  if (res.rows.length > 0) return false;
  await upsertProfile({
    worldview_context: DEFAULT_WORLDVIEW,
    topics: DEFAULT_TOPICS,
  });
  return true;
}

// ---------- sources ----------

export async function listSources(): Promise<NewsSourceRow[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute(`SELECT * FROM news_sources ORDER BY created_at DESC`);
  return res.rows as unknown as NewsSourceRow[];
}

export async function getSource(id: string): Promise<NewsSourceRow | null> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM news_sources WHERE id = ?`,
    args: [id],
  });
  return (res.rows[0] as unknown as NewsSourceRow) ?? null;
}

export async function createSource(input: {
  kind: SourceKind;
  url: string;
  name: string;
  fetch_interval_minutes?: number;
}): Promise<NewsSourceRow> {
  await ensureSchema();
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO news_sources
            (id, kind, url, name, fetch_interval_minutes, active, created_at)
          VALUES (?, ?, ?, ?, ?, 1, ?)`,
    args: [
      id,
      input.kind,
      input.url,
      input.name,
      input.fetch_interval_minutes ?? 30,
      now,
    ],
  });
  const row = await getSource(id);
  if (!row) throw new Error("source not found after insert");
  return row;
}

export async function deleteSource(id: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `DELETE FROM news_sources WHERE id = ?`,
    args: [id],
  });
}

export async function seedSourcesIfEmpty(): Promise<number> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute(`SELECT COUNT(*) AS n FROM news_sources`);
  const count = Number(res.rows[0]?.n ?? 0);
  if (count > 0) return 0;
  let inserted = 0;
  for (const s of DEFAULT_SOURCES) {
    try {
      await createSource(s);
      inserted++;
    } catch (err) {
      // Race с параллельным cron-tick'ом: второй tick видит count=0, начинает
      // сидить, первый уже вставил. Молча игнорируем дубликат — это норма.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/UNIQUE|constraint/i.test(msg)) throw err;
    }
  }
  return inserted;
}

// Атомарно забирает следующий due-источник под лок. Возвращает null, если
// нечего брать. Лок ставится на lockMinutes — после этого считаем брошенным.
// Логика due: last_fetched_at NULL или старше fetch_interval_minutes минут.
//
// Под контеншеном повторяет попытку до MAX_ATTEMPTS раз — без рекурсии, чтобы
// при сотнях source-ов под нагрузкой не упереться в стек.
const CLAIM_MAX_ATTEMPTS = 8;
export async function claimDueSource(
  _workerId: string,
  lockMinutes = 5,
): Promise<NewsSourceRow | null> {
  await ensureSchema();
  const db = getDb();

  for (let attempt = 0; attempt < CLAIM_MAX_ATTEMPTS; attempt++) {
    const now = new Date();
    const nowIso = now.toISOString();
    const lockUntilIso = new Date(now.getTime() + lockMinutes * 60_000).toISOString();

    const pick = await db.execute({
      sql: `SELECT id FROM news_sources
            WHERE active = 1
              AND (locked_until IS NULL OR locked_until < ?)
              AND (
                last_fetched_at IS NULL
                OR datetime(last_fetched_at, '+' || fetch_interval_minutes || ' minute') < ?
              )
            ORDER BY COALESCE(last_fetched_at, '1970-01-01') ASC, created_at ASC
            LIMIT 1`,
      args: [nowIso, nowIso],
    });
    const id = pick.rows[0]?.id as string | undefined;
    if (!id) return null;

    const upd = await db.execute({
      sql: `UPDATE news_sources
            SET locked_until = ?
            WHERE id = ?
              AND (locked_until IS NULL OR locked_until < ?)`,
      args: [lockUntilIso, id, nowIso],
    });
    if (upd.rowsAffected > 0) {
      return getSource(id);
    }
    // Кто-то опередил — пробуем ещё раз, возможно теперь другой source.
  }
  return null;
}

export async function releaseSource(id: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE news_sources SET locked_until = NULL WHERE id = ?`,
    args: [id],
  });
}

export async function setSourceFetched(
  id: string,
  fetchedAt = new Date().toISOString(),
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE news_sources
          SET last_fetched_at = ?, locked_until = NULL
          WHERE id = ?`,
    args: [fetchedAt, id],
  });
}

// Ставим runId впервые → проставляем started_at. Снимаем runId (null) →
// чистим started_at. Не делаем reset started_at, если runId уже стоит и
// зовётся повторно с тем же runId (защита от поедания stale-run таймера).
export async function setApifyRun(
  id: string,
  runId: string | null,
  status: string | null,
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  if (runId === null) {
    await db.execute({
      sql: `UPDATE news_sources
            SET apify_run_id = NULL, apify_run_status = ?, apify_run_started_at = NULL
            WHERE id = ?`,
      args: [status, id],
    });
    return;
  }
  // Ставим started_at только если runId меняется (или впервые ставится).
  const nowIso = new Date().toISOString();
  await db.execute({
    sql: `UPDATE news_sources
          SET apify_run_id = ?,
              apify_run_status = ?,
              apify_run_started_at = CASE
                WHEN apify_run_id IS NULL OR apify_run_id <> ? THEN ?
                ELSE apify_run_started_at
              END
          WHERE id = ?`,
    args: [runId, status, runId, nowIso, id],
  });
}

export async function updateApifyStatus(id: string, status: string | null): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE news_sources SET apify_run_status = ? WHERE id = ?`,
    args: [status, id],
  });
}

// ---------- items ----------

export interface InsertItemInput {
  source_id: string;
  external_id: string;
  url: string | null;
  title: string | null;
  body: string;
  published_at: string | null;
  raw_meta: Record<string, unknown>;
}

// Возвращает id вставленного item'а или null, если был дубликат (UNIQUE на
// source_id+external_id). Для дедупликации это нормальный путь.
export async function insertRawItem(input: InsertItemInput): Promise<string | null> {
  await ensureSchema();
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  try {
    const res = await db.execute({
      sql: `INSERT INTO news_items
              (id, source_id, external_id, url, title, body, published_at, raw_meta, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      args: [
        id,
        input.source_id,
        input.external_id,
        input.url,
        input.title,
        input.body,
        input.published_at,
        JSON.stringify(input.raw_meta ?? {}),
        now,
      ],
    });
    return res.rowsAffected > 0 ? id : null;
  } catch (err) {
    // UNIQUE conflict — дубликат, это ожидаемо.
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE/i.test(msg) || /constraint/i.test(msg)) return null;
    throw err;
  }
}

export async function getPendingItems(limit: number): Promise<NewsItemRow[]> {
  await ensureSchema();
  const db = getDb();
  const safeLimit = Math.min(Math.max(Number.isFinite(limit) ? limit : 10, 1), 200);
  const res = await db.execute({
    sql: `SELECT * FROM news_items WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`,
    args: [safeLimit],
  });
  return res.rows as unknown as NewsItemRow[];
}

export interface ValidationUpdate {
  status: NewsItemStatus;
  validation_input: string;
  validation_output_json: string | null;
  validation_error: string | null;
  model_used: string;
  summary: string | null;
  value_explanation: string | null;
  matched_topics: string[] | null;
  relevance: number | null;
  verdict: NewsItemVerdict | null;
  reasoning: string | null;
}

export async function applyValidation(
  itemId: string,
  upd: ValidationUpdate,
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE news_items
          SET status = ?,
              validation_input = ?,
              validation_output_json = ?,
              validation_error = ?,
              model_used = ?,
              summary = ?,
              value_explanation = ?,
              matched_topics_json = ?,
              relevance = ?,
              verdict = ?,
              reasoning = ?,
              validated_at = ?
          WHERE id = ?`,
    args: [
      upd.status,
      upd.validation_input,
      upd.validation_output_json,
      upd.validation_error,
      upd.model_used,
      upd.summary,
      upd.value_explanation,
      upd.matched_topics ? JSON.stringify(upd.matched_topics) : null,
      upd.relevance,
      upd.verdict,
      upd.reasoning,
      now,
      itemId,
    ],
  });
}

export interface ItemWithSource extends NewsItemRow {
  source_name: string;
  source_kind: SourceKind;
  source_url: string;
}

export async function listItems(opts: {
  verdict?: NewsItemVerdict | "all";
  limit?: number;
}): Promise<ItemWithSource[]> {
  await ensureSchema();
  const db = getDb();
  const rawLimit = Number.isFinite(opts.limit) ? (opts.limit as number) : 50;
  const limit = Math.min(Math.max(rawLimit, 1), 500);
  const where: string[] = [`i.status = 'validated'`];
  const args: (string | number)[] = [];
  if (opts.verdict && opts.verdict !== "all") {
    where.push(`i.verdict = ?`);
    args.push(opts.verdict);
  }
  args.push(limit);
  const res = await db.execute({
    sql: `SELECT i.*, s.name AS source_name, s.kind AS source_kind, s.url AS source_url
          FROM news_items i
          JOIN news_sources s ON s.id = i.source_id
          WHERE ${where.join(" AND ")}
          ORDER BY i.validated_at DESC, i.created_at DESC
          LIMIT ?`,
    args,
  });
  return res.rows as unknown as ItemWithSource[];
}

export async function listDecisions(limit: number): Promise<ItemWithSource[]> {
  await ensureSchema();
  const db = getDb();
  const lim = Math.min(Math.max(limit, 1), 200);
  const res = await db.execute({
    sql: `SELECT i.*, s.name AS source_name, s.kind AS source_kind, s.url AS source_url
          FROM news_items i
          JOIN news_sources s ON s.id = i.source_id
          WHERE i.status IN ('validated', 'failed')
          ORDER BY COALESCE(i.validated_at, i.created_at) DESC
          LIMIT ?`,
    args: [lim],
  });
  return res.rows as unknown as ItemWithSource[];
}

export async function getItem(id: string): Promise<ItemWithSource | null> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT i.*, s.name AS source_name, s.kind AS source_kind, s.url AS source_url
          FROM news_items i
          JOIN news_sources s ON s.id = i.source_id
          WHERE i.id = ?`,
    args: [id],
  });
  return (res.rows[0] as unknown as ItemWithSource) ?? null;
}

// Поднимает скрытый пост обратно в ленту. Также форсит status='validated':
// listItems фильтрует по status='validated', поэтому без этого продвинутый
// item остался бы невидимым (баг ревью H1).
export async function promoteItem(id: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE news_items
          SET verdict = 'show', status = 'validated'
          WHERE id = ?`,
    args: [id],
  });
}

// ---------- feedback ----------

export async function recordFeedback(input: {
  item_id: string;
  signal: "like" | "dislike" | "hide";
  reason_chip?: string | null;
  custom_text?: string | null;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO news_feedback (id, item_id, signal, reason_chip, custom_text)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      id,
      input.item_id,
      input.signal,
      input.reason_chip ?? null,
      input.custom_text ?? null,
    ],
  });
}

// ---------- stats для отладочной панели ----------

export interface NewsStats {
  total_items: number;
  pending: number;
  validated_show: number;
  validated_borderline: number;
  validated_skip: number;
  failed: number;
  feedback_likes: number;
  feedback_dislikes: number;
}

export async function getStats(): Promise<NewsStats> {
  await ensureSchema();
  const db = getDb();
  const items = await db.execute(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='validated' AND verdict='show' THEN 1 ELSE 0 END) AS show_v,
      SUM(CASE WHEN status='validated' AND verdict='borderline' THEN 1 ELSE 0 END) AS borderline,
      SUM(CASE WHEN status='validated' AND verdict='skip' THEN 1 ELSE 0 END) AS skip_v,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
    FROM news_items
  `);
  const r = items.rows[0] ?? {};
  const fb = await db.execute(`
    SELECT
      SUM(CASE WHEN signal='like' THEN 1 ELSE 0 END) AS likes,
      SUM(CASE WHEN signal='dislike' THEN 1 ELSE 0 END) AS dislikes
    FROM news_feedback
  `);
  const f = fb.rows[0] ?? {};
  return {
    total_items: Number(r.total ?? 0),
    pending: Number(r.pending ?? 0),
    validated_show: Number(r.show_v ?? 0),
    validated_borderline: Number(r.borderline ?? 0),
    validated_skip: Number(r.skip_v ?? 0),
    failed: Number(r.failed ?? 0),
    feedback_likes: Number(f.likes ?? 0),
    feedback_dislikes: Number(f.dislikes ?? 0),
  };
}
