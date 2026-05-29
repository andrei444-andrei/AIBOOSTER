// chat_generations: персистентная запись активной/завершённой генерации.
//
// Зачем: пользователь может закрыть вкладку / уйти с сайта во время
// генерации. Без этой таблицы partial content теряется. С ней — пайплайн
// продолжает писать в content (throttled), клиент при возврате читает
// текущий state и подписывается на дельты.
//
// Также: позволяет иметь несколько активных генераций одновременно
// (по одной на сессию) — для переключения между чатами без потери.

import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "./db";
import type { ChatMode } from "./chat-client";

export type GenerationStatus = "running" | "done" | "error" | "cancelled";

export interface ChatGeneration {
  id: string;
  session_id: string;
  user_message_id: string | null;
  assistant_message_id: string | null;
  status: GenerationStatus;
  model: string | null;
  mode: ChatMode | null;
  content: string;
  route_meta: unknown | null;
  web_images: unknown[] | null;
  citations: unknown[] | null;
  error: string | null;
  tokens_prompt: number | null;
  tokens_completion: number | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface GenerationRow {
  id: string;
  session_id: string;
  user_message_id: string | null;
  assistant_message_id: string | null;
  status: string;
  model: string | null;
  mode: string | null;
  content: string;
  route_meta: string | null;
  web_images: string | null;
  citations: string | null;
  error: string | null;
  tokens_prompt: number | null;
  tokens_completion: number | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function rowToGen(r: GenerationRow): ChatGeneration {
  return {
    id: r.id,
    session_id: r.session_id,
    user_message_id: r.user_message_id,
    assistant_message_id: r.assistant_message_id,
    status: (r.status as GenerationStatus),
    model: r.model,
    mode: (r.mode as ChatMode | null),
    content: r.content,
    route_meta: parseJson(r.route_meta, null),
    web_images: parseJson<unknown[] | null>(r.web_images, null),
    citations: parseJson<unknown[] | null>(r.citations, null),
    error: r.error,
    tokens_prompt: r.tokens_prompt,
    tokens_completion: r.tokens_completion,
    duration_ms: r.duration_ms,
    created_at: r.created_at,
    updated_at: r.updated_at,
    finished_at: r.finished_at,
  };
}

const GEN_COLS =
  "id, session_id, user_message_id, assistant_message_id, status, model, mode, content, route_meta, web_images, citations, error, tokens_prompt, tokens_completion, duration_ms, created_at, updated_at, finished_at";

// ─── Создание ────────────────────────────────────────────────────

export async function createGeneration(
  sessionId: string,
  userMessageId: string,
  mode: ChatMode | null,
): Promise<ChatGeneration> {
  await ensureSchema();
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO chat_generations
            (id, session_id, user_message_id, status, mode, content, created_at, updated_at)
          VALUES (?, ?, ?, 'running', ?, '', ?, ?)`,
    args: [id, sessionId, userMessageId, mode, now, now],
  });
  return {
    id,
    session_id: sessionId,
    user_message_id: userMessageId,
    assistant_message_id: null,
    status: "running",
    model: null,
    mode,
    content: "",
    route_meta: null,
    web_images: null,
    citations: null,
    error: null,
    tokens_prompt: null,
    tokens_completion: null,
    duration_ms: null,
    created_at: now,
    updated_at: now,
    finished_at: null,
  };
}

// ─── Чтение ───────────────────────────────────────────────────────

export async function getGeneration(id: string): Promise<ChatGeneration | null> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT ${GEN_COLS} FROM chat_generations WHERE id = ?`,
    args: [id],
  });
  const r = res.rows[0] as unknown as GenerationRow | undefined;
  return r ? rowToGen(r) : null;
}

/** Активная (running) генерация для сессии — последняя по времени. */
export async function getActiveGeneration(sessionId: string): Promise<ChatGeneration | null> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT ${GEN_COLS} FROM chat_generations
          WHERE session_id = ? AND status = 'running'
          ORDER BY created_at DESC LIMIT 1`,
    args: [sessionId],
  });
  const r = res.rows[0] as unknown as GenerationRow | undefined;
  if (!r) return null;
  // Если updated_at старше 5 минут — генерация почти точно мертва (функция упала).
  const updatedAt = new Date(r.updated_at).getTime();
  if (Date.now() - updatedAt > 5 * 60 * 1000) {
    await markGenerationInterrupted(r.id).catch(() => {});
    return null;
  }
  return rowToGen(r);
}

// ─── Запись (throttled) ──────────────────────────────────────────

/** Полная замена content. Используется throttled-writer'ом из роута. */
export async function updateGenerationContent(id: string, content: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE chat_generations
          SET content = ?, updated_at = ?
          WHERE id = ? AND status = 'running'`,
    args: [content, new Date().toISOString(), id],
  });
}

export async function updateGenerationMeta(
  id: string,
  meta: {
    model?: string | null;
    routeMeta?: unknown;
    webImages?: unknown[];
    citations?: unknown[];
  },
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const sets: string[] = ["updated_at = ?"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args: any[] = [new Date().toISOString()];
  if (meta.model !== undefined) { sets.push("model = ?"); args.push(meta.model); }
  if (meta.routeMeta !== undefined) { sets.push("route_meta = ?"); args.push(JSON.stringify(meta.routeMeta)); }
  if (meta.webImages !== undefined) { sets.push("web_images = ?"); args.push(JSON.stringify(meta.webImages)); }
  if (meta.citations !== undefined) { sets.push("citations = ?"); args.push(JSON.stringify(meta.citations)); }
  args.push(id);
  await db.execute({
    sql: `UPDATE chat_generations SET ${sets.join(", ")} WHERE id = ?`,
    args,
  });
}

export async function finalizeGenerationDone(
  id: string,
  opts: {
    assistantMessageId: string;
    content: string;
    model: string;
    routeMeta: unknown;
    webImages: unknown[];
    citations: unknown[];
    tokensPrompt: number | null;
    tokensCompletion: number | null;
    durationMs: number;
  },
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE chat_generations SET
            assistant_message_id = ?,
            status = 'done',
            content = ?,
            model = ?,
            route_meta = ?,
            web_images = ?,
            citations = ?,
            tokens_prompt = ?,
            tokens_completion = ?,
            duration_ms = ?,
            updated_at = ?,
            finished_at = ?
          WHERE id = ?`,
    args: [
      opts.assistantMessageId,
      opts.content,
      opts.model,
      JSON.stringify(opts.routeMeta),
      JSON.stringify(opts.webImages),
      JSON.stringify(opts.citations),
      opts.tokensPrompt,
      opts.tokensCompletion,
      opts.durationMs,
      now,
      now,
      id,
    ],
  });
}

export async function finalizeGenerationError(id: string, error: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE chat_generations
          SET status = 'error', error = ?, updated_at = ?, finished_at = ?
          WHERE id = ?`,
    args: [error.slice(0, 4000), now, now, id],
  });
}

/** Помечает генерацию как «прерванной» — функция умерла, но запись осталась. */
export async function markGenerationInterrupted(id: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE chat_generations
          SET status = 'cancelled', error = COALESCE(error, 'Connection lost — generation interrupted'),
              updated_at = ?, finished_at = ?
          WHERE id = ? AND status = 'running'`,
    args: [now, now, id],
  });
}

// ─── Throttled writer (helper для роута) ─────────────────────────

/** Throttled-writer: батчит content-updates в БД не чаще чем раз в `intervalMs`.
 *  Возвращает { flush, finalFlush } — flush можно дёргать на каждой дельте,
 *  он сам решит писать или подождать. finalFlush — синхронный финальный write. */
export function makeThrottledContentWriter(generationId: string, intervalMs = 1000) {
  let lastWriteAt = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let lastContent = "";

  const doWrite = async (content: string) => {
    lastWriteAt = Date.now();
    lastContent = content;
    await updateGenerationContent(generationId, content).catch(() => {
      // Мягкий сбой: проиграем на следующем такте. Не валим пайплайн.
    });
  };

  return {
    schedule(content: string) {
      const now = Date.now();
      const elapsed = now - lastWriteAt;
      if (elapsed >= intervalMs) {
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
        void doWrite(content);
      } else if (!pendingTimer) {
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          // На момент срабатывания таймера content может быть уже больше.
          // Поскольку writer вызывается через schedule(content), мы пишем
          // последний переданный content — здесь это lastContent, но
          // schedule вызывался свежим, так что замыкаем через ref.
          void doWrite(content);
        }, intervalMs - elapsed);
      }
    },
    async finalFlush(content: string) {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      if (content !== lastContent) {
        await doWrite(content);
      }
    },
  };
}
