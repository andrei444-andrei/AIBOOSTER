/**
 * Тонкий клиент Apify API. Только то, что реально нужно модулю scraper:
 * запуск нашего runner-актера, опрос статуса, чтение датасета.
 *
 * Токен (APIFY_TOKEN) живёт ТОЛЬКО на сервере. Любой код, импортирующий
 * этот файл, по определению не уходит в клиентский бандл — это серверные
 * утилиты для route-хендлеров.
 *
 * Документация Apify API: https://docs.apify.com/api/v2
 */

const BASE_URL = "https://api.apify.com/v2";

export class ApifyError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: string,
  ) {
    super(message);
    this.name = "ApifyError";
  }
}

function getTokenOrThrow(): string {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new ApifyError("APIFY_TOKEN is not set", 503);
  return t;
}

function getRunnerActorIdOrThrow(): string {
  const id = process.env.APIFY_RUNNER_ACTOR_ID;
  if (!id) throw new ApifyError("APIFY_RUNNER_ACTOR_ID is not set", 503);
  return id;
}

/**
 * Apify требует `~` вместо `/` в URL для actorId формата username/name.
 * Допустим обе формы на входе.
 */
function normalizeActorId(id: string): string {
  return id.replace("/", "~");
}

export interface ApifyRunSummary {
  id: string;
  actId: string;
  status:
    | "READY"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "TIMING-OUT"
    | "TIMED-OUT"
    | "ABORTING"
    | "ABORTED";
  startedAt: string;
  finishedAt?: string;
  defaultDatasetId?: string;
  defaultKeyValueStoreId?: string;
  exitCode?: number;
  stats?: {
    inputBodyLen?: number;
    durationMillis?: number;
  };
}

/**
 * Запускает наш runner-актер. Передаём произвольный input —
 * { code, params } для нашего runner-кейса.
 */
export async function startRunnerRun(input: unknown): Promise<ApifyRunSummary> {
  const token = getTokenOrThrow();
  const actorId = normalizeActorId(getRunnerActorIdOrThrow());

  const resp = await fetch(`${BASE_URL}/acts/${actorId}/runs?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new ApifyError(
      `Apify start run failed: ${resp.status} ${resp.statusText}`,
      resp.status,
      body || undefined,
    );
  }

  const json = (await resp.json()) as { data: ApifyRunSummary };
  return json.data;
}

/** Текущий статус run-а. */
export async function getRun(runId: string): Promise<ApifyRunSummary> {
  const token = getTokenOrThrow();

  const resp = await fetch(`${BASE_URL}/actor-runs/${runId}?token=${token}`);
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new ApifyError(
      `Apify get run failed: ${resp.status} ${resp.statusText}`,
      resp.status,
      body || undefined,
    );
  }
  const json = (await resp.json()) as { data: ApifyRunSummary };
  return json.data;
}

/** Прерывание run-а (если, например, юзер закрыл вкладку и хочет отменить). */
export async function abortRun(runId: string): Promise<void> {
  const token = getTokenOrThrow();
  const resp = await fetch(
    `${BASE_URL}/actor-runs/${runId}/abort?token=${token}`,
    { method: "POST" },
  );
  if (!resp.ok && resp.status !== 400) {
    // 400 — run уже завершён, это не ошибка для нашего кейса.
    const body = await resp.text().catch(() => "");
    throw new ApifyError(
      `Apify abort failed: ${resp.status} ${resp.statusText}`,
      resp.status,
      body || undefined,
    );
  }
}

/**
 * Чтение элементов из dataset. Возвращает массив объектов.
 * limit — максимум за один запрос (Apify дефолт 1000).
 */
export async function getDatasetItems<T = unknown>(
  datasetId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<T[]> {
  const token = getTokenOrThrow();
  const params = new URLSearchParams({ token, format: "json", clean: "true" });
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.offset !== undefined) params.set("offset", String(opts.offset));

  const resp = await fetch(
    `${BASE_URL}/datasets/${datasetId}/items?${params.toString()}`,
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new ApifyError(
      `Apify get dataset failed: ${resp.status} ${resp.statusText}`,
      resp.status,
      body || undefined,
    );
  }
  return (await resp.json()) as T[];
}

/**
 * Содержимое key-value store run-а. Используем для чтения OUTPUT и LOG.
 * Возвращает null, если ключа нет.
 */
export async function getKvRecord<T = unknown>(
  storeId: string,
  key: string,
): Promise<T | null> {
  const token = getTokenOrThrow();
  const resp = await fetch(
    `${BASE_URL}/key-value-stores/${storeId}/records/${encodeURIComponent(key)}?token=${token}`,
  );
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new ApifyError(
      `Apify get kv record failed: ${resp.status} ${resp.statusText}`,
      resp.status,
      body || undefined,
    );
  }
  // Пытаемся как JSON; если не получилось — отдаём как текст в виде unknown.
  const text = await resp.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/** Финальные статусы (run завершился, опрос больше не нужен). */
export function isTerminal(status: ApifyRunSummary["status"]): boolean {
  return (
    status === "SUCCEEDED" ||
    status === "FAILED" ||
    status === "TIMED-OUT" ||
    status === "ABORTED"
  );
}

/** Удачный финал. */
export function isSuccess(status: ApifyRunSummary["status"]): boolean {
  return status === "SUCCEEDED";
}
