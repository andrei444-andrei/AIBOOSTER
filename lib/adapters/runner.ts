// Runner — выполняет sync-job в текущем процессе (без отдельного воркера).
//
// Используется из /api/adapters/tick: после enqueue ставим в очередь, потом
// последовательно прогоняем job'ы с тайм-бюджетом. Это работает на Vercel
// (60с на pro), пока конкретный sync укладывается в окно.
//
// Когда какой-то источник перестанет укладываться — выделим внешний воркер
// и переключим runner на режим «только enqueue».

import { logError, logServerError } from "../logger";
import { getAdapter } from "./registry";
import {
  parseJsonField,
  markSourceError,
  scheduleNextRun,
  getSource,
  updateSourceCredentials,
} from "./sources";
import {
  claimNextSyncJob,
  finishSyncJob,
  updateSyncJob,
} from "./sync-jobs";
import type { AdapterSourceRow } from "./types";

const SAFETY_MARGIN_MS = 3000;

export async function runJobs(opts: {
  workerId: string;
  budgetMs: number;
  maxJobs?: number;
}): Promise<{ processed: number; jobIds: string[] }> {
  const started = Date.now();
  const deadline = started + opts.budgetMs - SAFETY_MARGIN_MS;
  const jobIds: string[] = [];
  let processed = 0;
  const max = opts.maxJobs ?? 10;

  while (processed < max && Date.now() < deadline) {
    const job = await claimNextSyncJob(opts.workerId);
    if (!job) break;
    jobIds.push(job.id);
    processed++;

    try {
      await runOneJob({
        jobId: job.id,
        sourceId: job.source_id,
        jobKind: job.job_kind,
        shouldStop: () => Date.now() >= deadline,
      });
    } catch (err) {
      // runOneJob сам всё логирует и пишет в БД — ловим как страховку.
      await logServerError(err, "adapters/runner", { job_id: job.id });
    }
  }

  return { processed, jobIds };
}

async function runOneJob(args: {
  jobId: string;
  sourceId: string;
  jobKind: string;
  shouldStop: () => boolean;
}): Promise<void> {
  const source = (await getSource(args.sourceId)) as AdapterSourceRow | null;
  if (!source) {
    await finishSyncJob({
      id: args.jobId,
      status: "error",
      errorMessage: "source not found",
    });
    return;
  }

  if (args.jobKind !== "pull") {
    // embed-job будет реализован отдельно.
    await finishSyncJob({
      id: args.jobId,
      status: "cancelled",
      errorMessage: `job_kind '${args.jobKind}' not implemented yet`,
    });
    return;
  }

  const adapter = getAdapter(source.kind);
  if (!adapter) {
    await finishSyncJob({
      id: args.jobId,
      status: "error",
      errorMessage: `adapter '${source.kind}' is not registered`,
    });
    await markSourceError({
      id: source.id,
      message: `adapter '${source.kind}' is not registered`,
    });
    return;
  }

  try {
    const creds = parseJsonField<unknown>(source.credentials) ?? {};
    const cursor = parseJsonField<unknown>(source.cursor);

    const result = await adapter.sync({
      sourceId: source.id,
      creds,
      cursor,
      onProgress: (n) => {
        // Прогресс пишем best-effort, ошибки игнорируем — не валим sync.
        updateSyncJob({ id: args.jobId, progress: n }).catch(() => undefined);
      },
    });

    // Если адаптер обновил creds (рефреш access_token, ротация ключа) — пишем
    // до scheduleNextRun, чтобы следующий запуск увидел уже свежие данные.
    // Best-effort: если запись упала, sync уже успешный, не валим всю job'у.
    if (result.newCreds !== undefined) {
      try {
        await updateSourceCredentials(source.id, result.newCreds);
      } catch (err) {
        await logServerError(err, "adapters/runner", {
          where: "persist_refreshed_credentials",
          source_id: source.id,
          kind: source.kind,
        });
      }
    }

    await finishSyncJob({
      id: args.jobId,
      status: "done",
      fetchedCount: result.fetched,
      stats: result.stats,
    });
    await scheduleNextRun({
      id: source.id,
      cursor: result.newCursor,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorId = await logError({
      level: "error",
      source: "server",
      route: "adapters/runner",
      message,
      stack: err instanceof Error ? err.stack ?? null : null,
      meta: { job_id: args.jobId, source_id: source.id, kind: source.kind },
    });
    await finishSyncJob({
      id: args.jobId,
      status: "error",
      errorMessage: message,
      errorId,
    });
    await markSourceError({ id: source.id, message, errorId });
  }
}
