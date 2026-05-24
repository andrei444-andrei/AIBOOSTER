/**
 * Самопровижининг Apify-актеров — §1 конституции, применённый к Apify.
 *
 * Любой модуль зовёт `ensureActor({ slug, actorName, sourceDir, envVars })`
 * и получает canonical ID актера (`username~actor-name`). Алгоритм:
 *
 *   1. Cache (in-process Map) — мгновенный возврат, если уже разрулили в текущем контейнере.
 *   2. Cache (apify_actors в БД) — если запись есть, возвращаем её и кладём в in-process cache.
 *   3. Список актеров пользователя на Apify (GET /v2/acts?my=1) — если есть с таким `name`,
 *      это наш (ранее задеплоенный руками или другим деплоем). Пишем в БД и используем.
 *   4. Создаём новый актер (POST /v2/acts), грузим исходники как SOURCE_FILES,
 *      ставим envVars, запускаем build, ждём до 45 секунд.
 *
 * Чтобы это работало на Vercel-serverless, файлы `apify-runner/` должны попадать в бандл
 * функции — это обеспечивается через `outputFileTracingIncludes` в next.config.mjs.
 *
 * APIFY_TOKEN — единственная env-переменная для Apify. APIFY_RUNNER_ACTOR_ID больше не нужна.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import { getDb, ensureSchema } from "./db";

const APIFY_BASE = "https://api.apify.com/v2";
const BUILD_TIMEOUT_MS = 45_000;
const BUILD_POLL_MS = 3_000;

export class ApifyProvisionError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: string,
  ) {
    super(message);
    this.name = "ApifyProvisionError";
  }
}

export interface EnsureActorOpts {
  /** Внутренний ключ в нашей БД. Уникальный per-приложение. */
  slug: string;
  /** Имя актера в Apify (часть пути URL, видна в Console). */
  actorName: string;
  /** Абсолютный путь к папке с исходниками актера (содержит Dockerfile, package.json, src/...). */
  sourceDir: string;
  /** Список файлов-исходников относительно sourceDir, которые загрузить на Apify. */
  sourceFiles: string[];
  /** Опциональные env-переменные для актера (например, AIMLAPI_KEY). */
  envVars?: Array<{ name: string; value: string; isSecret?: boolean }>;
  /** Человекочитаемые поля для актера. */
  title?: string;
}

// In-process кэш (per Lambda-инстанс). Сбрасывается при холодном старте — норма.
const CACHE = new Map<string, string>();

/**
 * Гарантирует существование актера и возвращает его canonical ID (для использования в API).
 */
export async function ensureActor(opts: EnsureActorOpts): Promise<string> {
  const cached = CACHE.get(opts.slug);
  if (cached) return cached;

  const token = getTokenOrThrow();
  await ensureSchema();
  const db = getDb();

  // 1. Кэш в БД.
  const dbRes = await db.execute({
    sql: `SELECT apify_actor_id FROM apify_actors WHERE slug = ?`,
    args: [opts.slug],
  });
  if (dbRes.rows[0]) {
    const id = (dbRes.rows[0] as unknown as { apify_actor_id: string })
      .apify_actor_id;
    CACHE.set(opts.slug, id);
    return id;
  }

  // 2. Поиск в Apify по имени (пагинированно — учитываем большие аккаунты).
  const existing = await findActorByName(token, opts.actorName);

  let actorId: string;
  let username: string;

  if (existing) {
    actorId = existing.id;
    username = existing.username;
    // Не трогаем чужой/уже задеплоенный актер: используем как есть.
  } else {
    // 3. Создаём новый актер.
    const createdResp = await api<{
      data: { id: string; username: string; name: string };
    }>(token, "POST", "/acts", {
      name: opts.actorName,
      title: opts.title ?? opts.actorName,
      isPublic: false,
      categories: ["AUTOMATION"],
    });
    actorId = createdResp.data.id;
    username = createdResp.data.username;

    // 4. Грузим исходники + envVars. С sourceType=SOURCE_FILES Apify
    // автоматически запустит build после PUT версии.
    const files = readSourceFiles(opts.sourceDir, opts.sourceFiles);
    await api(token, "PUT", `/acts/${actorId}/versions/0.0`, {
      versionNumber: "0.0",
      buildTag: "latest",
      sourceType: "SOURCE_FILES",
      sourceFiles: files,
      envVars: opts.envVars ?? [],
    });

    // 5. Триггерим build (на случай, если PUT не запустил его автоматически)
    // и ждём финала.
    const buildResp = await api<{ data: { id: string; status: string } }>(
      token,
      "POST",
      `/acts/${actorId}/builds?version=0.0`,
    );
    await waitForBuild(token, buildResp.data.id);
  }

  // На существующем актере — best-effort обновим envVars (полезно для AIMLAPI_KEY).
  if (existing && opts.envVars && opts.envVars.length > 0) {
    try {
      // Узнаём номер существующей версии.
      const verResp = await api<{
        data: { items: Array<{ versionNumber: string }> };
      }>(token, "GET", `/acts/${actorId}/versions`);
      const ver = verResp.data.items[0]?.versionNumber;
      if (ver) {
        await api(token, "PUT", `/acts/${actorId}/versions/${ver}`, {
          envVars: opts.envVars,
        });
      }
    } catch {
      // Тихо: если не удалось обновить env — другие helpers всё равно работают,
      // упадёт только llm() с понятной ошибкой.
    }
  }

  // Канонический ID удобнее в логах ("username~name").
  const canonical = `${username}~${opts.actorName}`;

  await db.execute({
    sql: `INSERT OR REPLACE INTO apify_actors
            (slug, apify_actor_id, apify_actor_name, last_built_at, created_at)
          VALUES (?, ?, ?, datetime('now'),
                  COALESCE((SELECT created_at FROM apify_actors WHERE slug = ?), datetime('now')))`,
    args: [opts.slug, canonical, opts.actorName, opts.slug],
  });

  CACHE.set(opts.slug, canonical);
  return canonical;
}

function getTokenOrThrow(): string {
  const t = process.env.APIFY_TOKEN;
  if (!t)
    throw new ApifyProvisionError(
      "APIFY_TOKEN не задан в окружении сервера",
      503,
    );
  return t;
}

async function api<T = unknown>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${APIFY_BASE}${path}${sep}token=${token}`;
  const r = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new ApifyProvisionError(
      `Apify ${method} ${path}: ${r.status} ${r.statusText}`,
      r.status,
      text,
    );
  }
  return (await r.json()) as T;
}

interface ActorListItem {
  id: string;
  name: string;
  username: string;
}

async function findActorByName(
  token: string,
  name: string,
): Promise<ActorListItem | null> {
  let offset = 0;
  const limit = 1000;
  for (let i = 0; i < 5; i++) {
    const res = await api<{ data: { items: ActorListItem[]; total: number } }>(
      token,
      "GET",
      `/acts?my=1&limit=${limit}&offset=${offset}`,
    );
    const items = res.data.items ?? [];
    const hit = items.find((a) => a.name === name);
    if (hit) return hit;
    if (items.length < limit) return null;
    offset += limit;
  }
  return null;
}

function readSourceFiles(
  sourceDir: string,
  files: string[],
): Array<{ name: string; format: "TEXT"; content: string }> {
  return files.map((rel) => {
    const full = nodePath.join(sourceDir, rel);
    const content = fs.readFileSync(full, "utf-8");
    return { name: rel, format: "TEXT" as const, content };
  });
}

async function waitForBuild(token: string, buildId: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < BUILD_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, BUILD_POLL_MS));
    const r = await api<{ data: { status: string } }>(
      token,
      "GET",
      `/actor-builds/${buildId}`,
    );
    const status = r.data.status;
    if (status === "SUCCEEDED") return;
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      throw new ApifyProvisionError(
        `Apify actor build завершился со статусом ${status}`,
        500,
      );
    }
  }
  // Build всё ещё идёт — не ошибка, но возвращаемся, чтобы не пробивать Vercel-таймаут.
  // Запуск актера с непостроенным билдом упадёт — это будет видно в run-логах,
  // следующая попытка увидит build готовым и сработает.
  throw new ApifyProvisionError(
    "Apify build не успел за 45 сек. Повтори запрос через минуту — он уже почти готов.",
    504,
  );
}
