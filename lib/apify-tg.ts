// Apify-клиент для публичных Telegram-каналов в **async-режиме**.
//
// Почему async, а не run-sync: run-sync блокирует HTTP-запрос на 30-90 секунд,
// что не помещается в таймаут Vercel-функций (60s на Pro, 10s на Hobby).
// Поэтому работаем в два визита cron-tick'а:
//   1) на первом — POST /runs (мгновенный), запоминаем runId
//   2) на втором — GET /runs/{id}, если SUCCEEDED → забираем dataset
//
// Actor задаётся env'ом APIFY_TELEGRAM_ACTOR (формат "username~actor-name"
// или "username/actor-name"). Дефолт — `lukaskrivka~telegram-scraper`
// (популярный community-actor для публичных каналов).
// Если не работает — поставь свой в Vercel env и переразверни.

const BASE = "https://api.apify.com/v2";

function actorId(): string {
  return (process.env.APIFY_TELEGRAM_ACTOR || "lukaskrivka~telegram-scraper").replace(
    "/",
    "~",
  );
}

export interface ApifyRunInfo {
  id: string;
  status: string;
  startedAt?: string;
  finishedAt?: string | null;
  datasetId?: string;
}

export interface NormalizedTelegramPost {
  external_id: string;
  url: string;
  title: string | null;
  body: string;
  published_at: string | null;
  raw_meta: Record<string, unknown>;
}

// Стартует async run actor'а. Возвращает runId и стартовый статус.
// Капы на размер: resultsLimit=20 — даже на первом фетче канала с архивом
// мы не утянем сотни постов и не сожжём ни Apify, ни валидатор.
export async function startTelegramRun(channelUrl: string): Promise<ApifyRunInfo> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set");

  const id = actorId();
  const res = await fetch(
    `${BASE}/acts/${id}/runs?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        startUrls: [{ url: channelUrl }],
        resultsLimit: 20,
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`apify start ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as { data?: ApifyRunInfo };
  if (!data.data?.id) {
    throw new Error("apify start: no run id in response");
  }
  return data.data;
}

export async function getRunStatus(runId: string): Promise<ApifyRunInfo> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set");

  const res = await fetch(
    `${BASE}/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`apify status ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as { data?: ApifyRunInfo };
  if (!data.data) throw new Error("apify status: empty response");
  return data.data;
}

// Тянет dataset завершённого run'а и нормализует посты.
// Apify возвращает разные формы для разных actor'ов и разных версий;
// нормализатор принимает несколько форм и не падает на лишних полях.
export async function fetchRunDataset(
  datasetId: string,
): Promise<NormalizedTelegramPost[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set");

  const res = await fetch(
    `${BASE}/datasets/${encodeURIComponent(datasetId)}/items?token=${encodeURIComponent(token)}&clean=true&format=json`,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`apify dataset ${res.status}: ${text.slice(0, 400)}`);
  }
  const items = (await res.json()) as unknown;
  if (!Array.isArray(items)) {
    throw new Error("apify dataset: not an array");
  }

  const normalized: NormalizedTelegramPost[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const post = normalizePost(r);
    if (post) normalized.push(post);
  }
  return normalized;
}

function normalizePost(r: Record<string, unknown>): NormalizedTelegramPost | null {
  // Извлекаем external_id из всех известных вариантов поля.
  const idRaw =
    r.message_id ??
    r.messageId ??
    r.id ??
    r.postId ??
    r.post_id ??
    parsePostIdFromUrl(typeof r.url === "string" ? r.url : null);
  const externalId = idRaw != null ? String(idRaw) : null;
  if (!externalId) return null;

  const body = String(
    r.text ?? r.content ?? r.message ?? r.html ?? r.body ?? "",
  ).trim();
  if (!body && !r.media && !r.photo && !r.video) {
    // Пустой пост без медиа — пропускаем.
    return null;
  }

  const url =
    typeof r.url === "string" && r.url
      ? r.url
      : typeof r.link === "string"
        ? r.link
        : "";

  const publishedAt = normalizeDate(
    r.date ?? r.publishedAt ?? r.published_at ?? r.timestamp,
  );

  const title = body ? body.split("\n")[0]?.slice(0, 200) ?? null : null;

  return {
    external_id: externalId,
    url,
    title,
    body,
    published_at: publishedAt,
    raw_meta: r,
  };
}

function parsePostIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  // https://t.me/CHANNEL/123 или https://t.me/s/CHANNEL/123
  const m = url.match(/t\.me\/(?:s\/)?[^/]+\/(\d+)/i);
  return m?.[1] ?? null;
}

function normalizeDate(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number") {
    // unix epoch — секунды или миллисекунды
    const ms = v > 10_000_000_000 ? v : v * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}
