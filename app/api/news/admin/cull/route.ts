// Cull-агент: дешёвая модель проходит по done-enrichments, помечает мусор и
// архивирует его (из ленты исчезает, в news/agent-log виден).
//
// Что считаем мусором:
//   - Мета-статья про «у нас нет источников» / «честный разбор того, что
//     можно и нельзя утверждать».
//   - Vendor case-study без независимого подтверждения цифр.
//   - article_body состоит из пересказа одного и того же абзаца N раз.
//   - Реальных конкретных фактов < 2 — пустой пересказ заголовка.
//
// Модель: google/gemini-2.5-flash (~$0.0002/штука = 5 центов на 250 статей).
// Решение бинарное: keep | delete. Reason — короткая фраза для лога.

import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "@/lib/db";
import { setItemArchived } from "@/lib/news";
import { chatJson } from "@/lib/aimlapi";
import { logServerError } from "@/lib/logger";

const CULL_MODEL = "google/gemini-2.5-flash";
const BATCH_SIZE = 30; // сколько обрабатываем за один POST (чтобы не упереться в 60s)
const PER_ITEM_TIMEOUT_MS = 12_000;

interface CullCandidate {
  id: string;
  title: string | null;
  url: string | null;
  source_name: string | null;
  article_body: string;
  sources_used_json: string | null;
}

interface CullVerdict {
  verdict: "keep" | "delete";
  reason: string;
}

const SYSTEM_PROMPT =
  `Ты — куратор новостной ленты. Решаешь, оставлять синтезированную карточку или удалить как мусор. ` +
  `Удаляй ТОЛЬКО ОДНУ из категорий:\n` +
  `1. МЕТА-СТАТЬЯ: статья в основном про то, что «у нас нет источников / Perplexity ничего не нашёл / честный разбор того, что мы не можем утверждать». Несколько абзацев такого = delete.\n` +
  `2. ВЕНДОРСКИЙ КЕЙС БЕЗ НЕЗАВИСИМОГО ПОДТВЕРЖДЕНИЯ: только сайт вендора в источниках (stripe.com/customers, anthropic.com/customers и т.п.), цифры заявлены вендором, нет ни одного независимого источника.\n` +
  `3. ПУСТОЙ ПЕРЕСКАЗ ЗАГОЛОВКА: статья 200-500 слов, по сути повторяет заголовок 3-5 раз разными словами без фактов.\n` +
  `4. ОДИНОЧНЫЙ ПРЕСС-РЕЛИЗ БЕЗ КОНТЕКСТА: пресс-релиз с 0 независимыми источниками И без конкретных цифр/имён/дат.\n` +
  `\nВСЁ ОСТАЛЬНОЕ — keep. Не удаляй из-за: «обобщения», «слабая структура», «нет инлайн-картинок», «не моя тема». Не суди по релевантности темы — только по фактической наполненности и честности источников.\n` +
  `\nФормат ответа — СТРОГО JSON: {"verdict": "keep" | "delete", "reason": "1 короткая фраза почему"}`;

function buildUser(c: CullCandidate): string {
  const sources = parseSourcesArr(c.sources_used_json);
  const sourcesBlock = sources.length
    ? sources.map((s, i) => `  ${i + 1}. [${s.role || "?"}] ${s.title || s.url}`).join("\n")
    : "  (пусто)";
  return [
    `Заголовок: ${c.title || "(нет)"}`,
    `Источник в ленте: ${c.source_name || "?"}`,
    `URL оригинала: ${c.url || "—"}`,
    ``,
    `Sources_used (${sources.length}):`,
    sourcesBlock,
    ``,
    `Тело статьи (первые 3000 chars из ${c.article_body.length}):`,
    c.article_body.slice(0, 3000),
    ``,
    `Верни JSON-вердикт.`,
  ].join("\n");
}

function parseSourcesArr(s: string | null): Array<{ url?: string; title?: string; role?: string }> {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function judgeItem(c: CullCandidate): Promise<CullVerdict | null> {
  try {
    const res = await chatJson<{ verdict?: string; reason?: string }>({
      model: CULL_MODEL,
      system: SYSTEM_PROMPT,
      user: buildUser(c),
      temperature: 0,
      timeoutMs: PER_ITEM_TIMEOUT_MS,
      maxTokens: 200,
      requestId: c.id,
    });
    const v = res.parsed?.verdict;
    if (v !== "keep" && v !== "delete") return null;
    return {
      verdict: v,
      reason: typeof res.parsed?.reason === "string" ? res.parsed.reason.slice(0, 300) : "",
    };
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/news/admin/cull?dryRun=1 — не применять, только показать план
// POST /api/news/admin/cull — реально архивируем
async function handle(req: Request) {
  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dryRun") === "1";
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "0", 10) || BATCH_SIZE, 1), 100);

    await ensureSchema();
    const db = getDb();
    // Берём done-enrichments по не-архивированным items, у которых синтез есть.
    const rowsRes = await db.execute({
      sql: `SELECT i.id, i.title, i.url, s.name AS source_name,
                   e.synthesized_summary AS article_body,
                   e.sources_used_json
            FROM news_enrichments e
            JOIN news_items i ON i.id = e.item_id
            JOIN news_sources s ON s.id = i.source_id
            WHERE e.status = 'done'
              AND e.synthesized_summary IS NOT NULL
              AND length(e.synthesized_summary) > 100
              AND COALESCE(i.archived, 0) = 0
            ORDER BY i.validated_at DESC, i.created_at DESC
            LIMIT ?`,
      args: [limit],
    });

    const candidates: CullCandidate[] = (rowsRes.rows as unknown as CullCandidate[]).map((r) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      source_name: r.source_name,
      article_body: r.article_body || "",
      sources_used_json: r.sources_used_json,
    }));

    // Параллельно по 8, чтобы не упереться в rate-limit.
    const CONCURRENCY = 8;
    const results: Array<{ id: string; title: string | null; verdict: CullVerdict | null }> = [];
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const slice = candidates.slice(i, i + CONCURRENCY);
      const verdicts = await Promise.all(slice.map((c) => judgeItem(c)));
      for (let j = 0; j < slice.length; j++) {
        results.push({ id: slice[j].id, title: slice[j].title, verdict: verdicts[j] });
      }
    }

    const toDelete = results.filter((r) => r.verdict?.verdict === "delete");
    const toKeep = results.filter((r) => r.verdict?.verdict === "keep");
    const undecided = results.filter((r) => !r.verdict);

    let archived_count = 0;
    if (!dryRun) {
      for (const r of toDelete) {
        try {
          await setItemArchived(r.id, true);
          archived_count++;
        } catch (err) {
          await logServerError(err, "news/admin/cull:archive");
        }
      }
    }

    return Response.json({
      ok: true,
      dryRun,
      run_id: randomUUID(),
      scanned: candidates.length,
      to_delete: toDelete.length,
      to_keep: toKeep.length,
      undecided: undecided.length,
      archived_count,
      // Примерная стоимость: Gemini Flash ~$0.075/M input, ~$0.30/M output.
      // Per-item ~1.5K input + 50 output = ~$0.00012. Округляем до 0.02¢.
      estimated_cost_cents: Math.ceil(candidates.length * 0.02),
      sample_deletes: toDelete.slice(0, 10).map((r) => ({
        id: r.id,
        title: r.title,
        reason: r.verdict?.reason,
      })),
    });
  } catch (err) {
    const error_id = await logServerError(err, "news/admin/cull");
    return Response.json({ ok: false, error_id }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
