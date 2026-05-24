/**
 * Оркестратор модуля scraper.
 *
 * MVP — без self-healing цикла: одна попытка, fail-fast.
 * Шаги:
 *   1) DB insert (status="pending")
 *   2) LLM генерирует код    (status="planning")
 *   3) Apify запускается     (status="running")
 *   4) Поллим Apify          (вызывается отдельно через /api/scraper/runs/[id])
 *   5) Когда Apify закончил — забираем датасет и зовём суммаризатор (status="summarizing")
 *   6) status="succeeded" или "failed"
 *
 * Дизайн: оркестратор stateless относительно времени. Все долгие операции
 * (Apify run) выполняются на стороне Apify. Наш бэкенд только:
 *   - запускает (синхронно за один request)
 *   - проверяет статус по требованию (когда фронт поллит)
 *   - суммаризирует результат
 * Это вписывается в serverless-таймауты Vercel.
 */

import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "@/lib/db";
import { logServerError } from "@/lib/logger";
import { chat, chatText, MODELS, AIError } from "@/lib/ai";
import {
  startRunnerRun,
  getRun,
  getDatasetItems,
  isTerminal,
  isSuccess,
  ApifyError,
  type ApifyRunSummary,
} from "@/lib/apify";
import {
  CODE_GENERATOR_SYSTEM,
  SUMMARIZER_SYSTEM,
  buildCodeGenUserMessage,
  buildSummarizerUserMessage,
} from "./prompts";
import type {
  CodeGenResult,
  ScraperRunRow,
  ScraperAttemptRow,
  ScraperRunView,
} from "./types";

const MAX_PROMPT_LEN = 4000;
const ITEMS_PREVIEW_LIMIT = 20;

/**
 * Шаг 1+2+3: создать run, сгенерировать код, отправить в Apify.
 * Возвращает runId. Дальше фронт сам поллит через getRunView().
 *
 * Кидает Error при невалидном промпте или провале LLM/Apify до старта.
 */
export async function startRun(prompt: string): Promise<string> {
  const trimmed = (prompt ?? "").trim();
  if (!trimmed) throw new Error("Промпт пустой");
  if (trimmed.length > MAX_PROMPT_LEN) {
    throw new Error(`Промпт длиннее ${MAX_PROMPT_LEN} символов`);
  }

  await ensureSchema();
  const db = getDb();
  const runId = randomUUID();

  await db.execute({
    sql: `INSERT INTO scraper_runs (id, prompt, status) VALUES (?, ?, 'pending')`,
    args: [runId, trimmed],
  });

  // Шаг "planning": LLM генерит код.
  await updateStatus(runId, "planning");
  let plan: CodeGenResult;
  try {
    plan = await generateCode(trimmed);
  } catch (err) {
    const errorId = await logServerError(err, "/scraper/startRun:generateCode", {
      runId,
    });
    await markFailed(runId, errorId, friendlyAiError(err));
    throw err;
  }

  // Записываем попытку (n=1) в БД ДО запуска Apify — на случай, если Apify упадёт.
  const attemptId = randomUUID();
  await db.execute({
    sql: `INSERT INTO scraper_attempts (id, run_id, n, code, reasoning) VALUES (?, ?, 1, ?, ?)`,
    args: [attemptId, runId, plan.code, plan.reasoning ?? null],
  });

  // Шаг "running": отправляем в Apify.
  let apifyRun: ApifyRunSummary;
  try {
    apifyRun = await startRunnerRun({
      code: plan.code,
      params: {},
    });
  } catch (err) {
    const errorId = await logServerError(err, "/scraper/startRun:startApify", {
      runId,
    });
    await markFailed(runId, errorId, friendlyApifyError(err));
    throw err;
  }

  await db.execute({
    sql: `UPDATE scraper_attempts SET apify_run_id = ? WHERE id = ?`,
    args: [apifyRun.id, attemptId],
  });
  await db.execute({
    sql: `UPDATE scraper_runs
          SET apify_run_id = ?, apify_dataset_id = ?, status = 'running',
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [apifyRun.id, apifyRun.defaultDatasetId ?? null, runId],
  });

  return runId;
}

/**
 * Получить полное состояние run-а. Если Apify-run уже не RUNNING — продвигает
 * статус в БД (succeeded/failed) и подтягивает данные/сводку.
 *
 * Эту функцию зовёт GET /api/scraper/runs/[id] — то есть "тик" происходит
 * естественно при поллинге фронтом.
 */
export async function getRunView(runId: string): Promise<ScraperRunView | null> {
  await ensureSchema();
  const db = getDb();

  const row = await fetchRunRow(runId);
  if (!row) return null;

  // Если статус нефинальный и есть apify_run_id — опросим Apify и продвинем.
  if (
    (row.status === "running" || row.status === "summarizing") &&
    row.apify_run_id
  ) {
    try {
      await advance(row);
    } catch (err) {
      // Продвижение может упасть (сетевой сбой при опросе Apify, например).
      // Логируем, но не помечаем run как failed — следующий тик может починить.
      await logServerError(err, "/scraper/getRunView:advance", { runId });
    }
  }

  const fresh = (await fetchRunRow(runId))!;
  const attempts = await fetchAttempts(runId);

  let items_preview: unknown[] | undefined;
  if (
    fresh.status === "succeeded" &&
    fresh.apify_dataset_id &&
    (fresh.result_count ?? 0) > 0
  ) {
    try {
      items_preview = await getDatasetItems(fresh.apify_dataset_id, {
        limit: ITEMS_PREVIEW_LIMIT,
      });
    } catch (err) {
      await logServerError(err, "/scraper/getRunView:preview", { runId });
    }
  }

  return { ...fresh, attempts, items_preview };
}

/** Список последних запусков для главной страницы модуля. */
export async function listRecentRuns(limit = 20): Promise<ScraperRunRow[]> {
  await ensureSchema();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT id, created_at, updated_at, prompt, status, apify_run_id,
                 apify_dataset_id, result_count, result_summary, error_id, error_message
          FROM scraper_runs
          ORDER BY created_at DESC, rowid DESC
          LIMIT ?`,
    args: [limit],
  });
  return result.rows as unknown as ScraperRunRow[];
}

// --- internal ---

async function generateCode(userPrompt: string): Promise<CodeGenResult> {
  const r = await chat({
    model: MODELS.CLAUDE_SONNET,
    messages: [
      { role: "system", content: CODE_GENERATOR_SYSTEM },
      { role: "user", content: buildCodeGenUserMessage(userPrompt) },
    ],
    temperature: 0.2,
    max_tokens: 2000,
    response_format: { type: "json_object" },
  });

  const raw = r.choices[0]?.message?.content;
  if (!raw) throw new AIError("LLM вернула пустой ответ", 502);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Иногда модель оборачивает JSON в ```json ... ```
    const stripped = raw
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    parsed = JSON.parse(stripped);
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as CodeGenResult).code !== "string"
  ) {
    throw new AIError(`LLM вернула невалидный JSON: ${raw.slice(0, 200)}`, 502);
  }

  const result = parsed as CodeGenResult;
  if (!result.code.trim()) {
    throw new AIError("LLM вернула пустой код", 502);
  }
  return {
    reasoning: result.reasoning ?? "",
    code: result.code,
  };
}

async function advance(row: ScraperRunRow): Promise<void> {
  if (!row.apify_run_id) return;

  const apify = await getRun(row.apify_run_id);
  if (!isTerminal(apify.status)) return;

  // Обновим items_count в attempts (если можем).
  let datasetItems: unknown[] = [];
  if (apify.defaultDatasetId) {
    try {
      datasetItems = await getDatasetItems(apify.defaultDatasetId, {
        limit: 1000,
      });
    } catch (err) {
      await logServerError(err, "/scraper/advance:getDataset", {
        runId: row.id,
      });
    }
  }

  const db = getDb();
  await db.execute({
    sql: `UPDATE scraper_attempts
          SET items_count = ?
          WHERE run_id = ? AND n = 1`,
    args: [datasetItems.length, row.id],
  });

  if (!isSuccess(apify.status)) {
    // Apify run упал. Достанем причину из логов/output.
    const reason =
      apify.exitCode != null
        ? `Apify-run завершился со статусом ${apify.status}, exit ${apify.exitCode}`
        : `Apify-run завершился со статусом ${apify.status}`;
    const errorId = await logServerError(
      new Error(reason),
      "/scraper/advance:apifyFailed",
      { runId: row.id, apifyRunId: apify.id },
    );
    await markFailed(row.id, errorId, reason);
    return;
  }

  if (datasetItems.length === 0) {
    // Run прошёл, но 0 элементов. Это считаем "succeeded but empty" — не fail.
    await db.execute({
      sql: `UPDATE scraper_runs
            SET status = 'succeeded',
                result_count = 0,
                result_summary = ?,
                updated_at = datetime('now')
            WHERE id = ?`,
      args: ["Скрейпер отработал, но не нашёл ни одной записи.", row.id],
    });
    return;
  }

  // Есть данные → переводим в "summarizing" и зовём LLM.
  await db.execute({
    sql: `UPDATE scraper_runs
          SET status = 'summarizing',
              result_count = ?,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [datasetItems.length, row.id],
  });

  let summary: string;
  try {
    summary = await chatText({
      model: MODELS.CLAUDE_SONNET,
      system: SUMMARIZER_SYSTEM,
      user: buildSummarizerUserMessage(row.prompt, datasetItems),
      temperature: 0.3,
      max_tokens: 800,
    });
  } catch (err) {
    // Если суммаризатор упал — это не fatal, отдадим без сводки.
    await logServerError(err, "/scraper/advance:summarize", { runId: row.id });
    summary = "_(не удалось сгенерировать сводку, но данные собраны — см. таблицу)_";
  }

  await db.execute({
    sql: `UPDATE scraper_runs
          SET status = 'succeeded',
              result_summary = ?,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [summary, row.id],
  });
}

async function fetchRunRow(runId: string): Promise<ScraperRunRow | null> {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT id, created_at, updated_at, prompt, status, apify_run_id,
                 apify_dataset_id, result_count, result_summary, error_id, error_message
          FROM scraper_runs WHERE id = ?`,
    args: [runId],
  });
  return (result.rows[0] as unknown as ScraperRunRow) ?? null;
}

async function fetchAttempts(runId: string): Promise<ScraperAttemptRow[]> {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT id, run_id, created_at, n, code, reasoning,
                 apify_run_id, items_count, error
          FROM scraper_attempts WHERE run_id = ? ORDER BY n ASC`,
    args: [runId],
  });
  return result.rows as unknown as ScraperAttemptRow[];
}

async function updateStatus(runId: string, status: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE scraper_runs SET status = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [status, runId],
  });
}

async function markFailed(
  runId: string,
  errorId: string,
  message: string,
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE scraper_runs
          SET status = 'failed', error_id = ?, error_message = ?, updated_at = datetime('now')
          WHERE id = ?`,
    args: [errorId, message, runId],
  });
}

function friendlyAiError(err: unknown): string {
  if (err instanceof AIError) {
    if (err.status === 503) return "AI-шлюз не настроен (AIMLAPI_KEY).";
    return `AI-шлюз вернул ${err.status}. Попробуй переформулировать запрос.`;
  }
  return "Не удалось сгенерировать код. Попробуй переформулировать запрос.";
}

function friendlyApifyError(err: unknown): string {
  if (err instanceof ApifyError) {
    if (err.status === 503) {
      return "Apify не настроен (APIFY_TOKEN или APIFY_RUNNER_ACTOR_ID). Проверь env.";
    }
    if (err.status === 401 || err.status === 403) {
      return "Apify не принял токен. Проверь APIFY_TOKEN.";
    }
    if (err.status === 404) {
      return "Runner-актер не найден. Проверь APIFY_RUNNER_ACTOR_ID и что актер задеплоен.";
    }
    return `Apify вернул ${err.status}.`;
  }
  return "Не удалось запустить скрейпер на Apify.";
}
