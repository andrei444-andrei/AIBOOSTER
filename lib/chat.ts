import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "./db";
import { DEFAULT_MODEL } from "./ai";
import {
  MODEL_OPTIONS,
  getModelOption,
  isKnownModel,
  isTaskCategory,
  isChatMode,
  DEFAULT_ENABLED_BLOCKS,
  type TaskCategory,
  type ChatMode,
  type EnabledBlocks,
  type ModelOption,
} from "./chat-client";

export {
  MODEL_OPTIONS,
  getModelOption,
  isKnownModel,
  isTaskCategory,
  isChatMode,
  DEFAULT_ENABLED_BLOCKS,
};
export type { TaskCategory, ChatMode, EnabledBlocks, ModelOption };

// ─── Типы ────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  uid: string;
  title: string;
  /** Последняя фактически использованная модель (для дисплея). */
  model: string;
  /** Режим ответа, выбранный пользователем. NULL = Auto (роутер выбирает thinking/pro по сложности). */
  mode: ChatMode | null;
  /** Конкретная модель, явно выбранная пользователем (legacy power-user override). */
  model_override: string | null;
  /** Категория-пресет (legacy — пользователю не показывается, но в БД остаётся). */
  category_override: TaskCategory | null;
  created_at: string;
  updated_at: string;
}

export type ChatRole = "user" | "assistant" | "system";

export interface ChatAttachment {
  id: string;
  message_id: string;
  filename: string;
  mime_type: string;
  size: number;
  kind: "text" | "image" | "image_url";
  content_text: string | null;
  content_base64: string | null;
  created_at: string;
}

export interface RouteMeta {
  /** Какой режим был использован — для UI-индикатора и истории. */
  mode?: ChatMode;
  /** Внутренняя категория (используется для system_addon-форматирования). */
  category: string;
  complexity: string;
  source: "override-model" | "override-category" | "override-mode" | "auto" | "fallback";
  reason: string;
  reasoning_effort?: string | null;
  uncertain?: boolean;
  /** Сколько мс занял сам роутер (классификатор). */
  routing_latency_ms?: number;
  /** Шаг 1 пайплайна Thinking/Pro: Sonar собрал факты. */
  web_step?: {
    model: string;
    duration_ms: number;
    tokens: number;
    citations_count: number;
    images_count: number;
  };
  // ─── Ensemble + Judge (PR #25 фронт это уже рендерит) ─────────────
  /** Прошёл ли запрос через ансамбль 2-3 моделей + судью. */
  ensemble?: boolean;
  /** Полные ответы кандидатов с метаданными — для коллапсибла «что ответили модели». */
  candidates?: Array<{
    model: string;
    duration_ms: number;
    tokens?: number;
    response: string;
    error?: string | null;
  }>;
  /** Кто синтезировал финальный ответ. */
  judge?: { model: string; duration_ms: number; tokens?: number };
  /** Сумма от первого fetch'а кандидата до окончания стрима судьи. */
  total_duration_ms?: number;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  model: string | null;
  tokens_prompt: number | null;
  tokens_completion: number | null;
  duration_ms: number | null;
  route_meta: RouteMeta | null;
  created_at: string;
  attachments?: ChatAttachment[];
}

export interface ChatSettings {
  system_prompt: string;
  enabled_blocks: EnabledBlocks;
  updated_at: string;
}

export const DEFAULT_SYSTEM_PROMPT = `Ты — AI-ассистент в AIBOOSTER. Отвечай по делу, на языке вопроса.
Когда полезно — структурируй ответ заголовками ## и ###, выделяй ключевые слова **жирным**, используй списки и таблицы для сравнения вариантов. Длинные пояснения дроби на разделы.`;

// ─── Сессии ──────────────────────────────────────────────────────────

export interface CreateSessionOpts {
  mode?: ChatMode | null;
  modelOverride?: string | null;
  categoryOverride?: TaskCategory | null;
  title?: string;
}

export async function createSession(
  uid: string,
  opts: CreateSessionOpts = {},
): Promise<ChatSession> {
  await ensureSchema();
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const mode = opts.mode && isChatMode(opts.mode) ? opts.mode : null;
  const modelOverride =
    opts.modelOverride && isKnownModel(opts.modelOverride) ? opts.modelOverride : null;
  const categoryOverride =
    opts.categoryOverride && isTaskCategory(opts.categoryOverride) ? opts.categoryOverride : null;
  // model — стартовое значение для UI (что писать в сайдбаре до первого ответа).
  const model = modelOverride ?? DEFAULT_MODEL;
  const title = opts.title?.slice(0, 200) ?? "Новый чат";
  await db.execute({
    sql: `INSERT INTO chat_sessions (id, uid, title, model, mode, model_override, category_override, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, uid, title, model, mode, modelOverride, categoryOverride, now, now],
  });
  return {
    id,
    uid,
    title,
    model,
    mode,
    model_override: modelOverride,
    category_override: categoryOverride,
    created_at: now,
    updated_at: now,
  };
}

const SESSION_COLS = "id, uid, title, model, mode, model_override, category_override, created_at, updated_at";

export async function listSessions(uid: string, limit = 100): Promise<ChatSession[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT ${SESSION_COLS}
          FROM chat_sessions WHERE uid = ?
          ORDER BY updated_at DESC LIMIT ?`,
    args: [uid, limit],
  });
  return res.rows as unknown as ChatSession[];
}

export async function getSession(id: string, uid: string): Promise<ChatSession | null> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT ${SESSION_COLS}
          FROM chat_sessions WHERE id = ? AND uid = ?`,
    args: [id, uid],
  });
  return (res.rows[0] as unknown as ChatSession) ?? null;
}

export async function deleteSession(id: string, uid: string): Promise<boolean> {
  await ensureSchema();
  const db = getDb();
  const session = await getSession(id, uid);
  if (!session) return false;
  await db.execute({
    sql: `DELETE FROM chat_attachments WHERE message_id IN
           (SELECT id FROM chat_messages WHERE session_id = ?)`,
    args: [id],
  });
  await db.execute({ sql: `DELETE FROM chat_messages WHERE session_id = ?`, args: [id] });
  await db.execute({ sql: `DELETE FROM chat_sessions WHERE id = ?`, args: [id] });
  return true;
}

export async function renameSession(id: string, uid: string, title: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ? AND uid = ?`,
    args: [title.slice(0, 200), new Date().toISOString(), id, uid],
  });
}

/** Обновить «последнюю модель», которой ассистент отвечал (для дисплея). */
export async function setSessionLastModel(id: string, uid: string, model: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE chat_sessions SET model = ?, updated_at = ? WHERE id = ? AND uid = ?`,
    args: [model, new Date().toISOString(), id, uid],
  });
}

/** Зафиксировать конкретную модель для чата. NULL = снять override.
 *  Установка модели сбрасывает category_override (нельзя оба сразу). */
export async function setSessionModelOverride(
  id: string,
  uid: string,
  model: string | null,
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE chat_sessions
          SET model_override = ?, category_override = NULL, updated_at = ?
          WHERE id = ? AND uid = ?`,
    args: [model, new Date().toISOString(), id, uid],
  });
}

/** Зафиксировать категорию-пресет для чата. NULL = снять. Сбрасывает model_override. */
export async function setSessionCategoryOverride(
  id: string,
  uid: string,
  category: TaskCategory | null,
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE chat_sessions
          SET category_override = ?, model_override = NULL, updated_at = ?
          WHERE id = ? AND uid = ?`,
    args: [category, new Date().toISOString(), id, uid],
  });
}

/** Полностью сбросить выбор пользователя — вернуться в Auto. */
export async function clearSessionOverride(id: string, uid: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE chat_sessions
          SET model_override = NULL, category_override = NULL, mode = NULL, updated_at = ?
          WHERE id = ? AND uid = ?`,
    args: [new Date().toISOString(), id, uid],
  });
}

/** Зафиксировать режим (thinking/pro/judge/image) для чата.
 *  NULL = Auto (роутер сам решает thinking/pro). */
export async function setSessionMode(
  id: string,
  uid: string,
  mode: ChatMode | null,
): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE chat_sessions
          SET mode = ?, updated_at = ?
          WHERE id = ? AND uid = ?`,
    args: [mode, new Date().toISOString(), id, uid],
  });
}

async function touchSession(id: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE chat_sessions SET updated_at = ? WHERE id = ?`,
    args: [new Date().toISOString(), id],
  });
}

// ─── Сообщения и вложения ────────────────────────────────────────────

export interface CreateAttachmentInput {
  filename: string;
  mime_type: string;
  size: number;
  kind: "text" | "image" | "image_url";
  content_text?: string | null;
  content_base64?: string | null;
}

export async function appendMessage(
  sessionId: string,
  role: ChatRole,
  content: string,
  opts: {
    model?: string | null;
    tokensPrompt?: number | null;
    tokensCompletion?: number | null;
    durationMs?: number | null;
    routeMeta?: RouteMeta | null;
    attachments?: CreateAttachmentInput[];
  } = {},
): Promise<ChatMessage> {
  await ensureSchema();
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO chat_messages
            (id, session_id, role, content, model, tokens_prompt, tokens_completion, duration_ms, route_meta, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      sessionId,
      role,
      content,
      opts.model ?? null,
      opts.tokensPrompt ?? null,
      opts.tokensCompletion ?? null,
      opts.durationMs ?? null,
      opts.routeMeta ? JSON.stringify(opts.routeMeta) : null,
      now,
    ],
  });

  const attachments: ChatAttachment[] = [];
  for (const a of opts.attachments ?? []) {
    const aid = randomUUID();
    await db.execute({
      sql: `INSERT INTO chat_attachments
              (id, message_id, filename, mime_type, size, kind, content_text, content_base64, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        aid,
        id,
        a.filename,
        a.mime_type,
        a.size,
        a.kind,
        a.content_text ?? null,
        a.content_base64 ?? null,
        now,
      ],
    });
    attachments.push({
      id: aid,
      message_id: id,
      filename: a.filename,
      mime_type: a.mime_type,
      size: a.size,
      kind: a.kind,
      content_text: a.content_text ?? null,
      content_base64: a.content_base64 ?? null,
      created_at: now,
    });
  }

  await touchSession(sessionId);

  return {
    id,
    session_id: sessionId,
    role,
    content,
    model: opts.model ?? null,
    tokens_prompt: opts.tokensPrompt ?? null,
    tokens_completion: opts.tokensCompletion ?? null,
    duration_ms: opts.durationMs ?? null,
    route_meta: opts.routeMeta ?? null,
    created_at: now,
    attachments,
  };
}

interface ChatMessageRow {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  model: string | null;
  tokens_prompt: number | null;
  tokens_completion: number | null;
  duration_ms: number | null;
  route_meta: string | null;
  created_at: string;
}

function parseRouteMeta(raw: string | null): RouteMeta | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RouteMeta;
  } catch {
    return null;
  }
}

export async function listMessages(sessionId: string): Promise<ChatMessage[]> {
  await ensureSchema();
  const db = getDb();
  const msgs = await db.execute({
    sql: `SELECT id, session_id, role, content, model, tokens_prompt, tokens_completion, duration_ms, route_meta, created_at
          FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`,
    args: [sessionId],
  });
  const rows = msgs.rows as unknown as ChatMessageRow[];
  const messages: ChatMessage[] = rows.map((r) => ({
    id: r.id,
    session_id: r.session_id,
    role: r.role,
    content: r.content,
    model: r.model,
    tokens_prompt: r.tokens_prompt,
    tokens_completion: r.tokens_completion,
    duration_ms: r.duration_ms,
    route_meta: parseRouteMeta(r.route_meta),
    created_at: r.created_at,
  }));
  if (messages.length === 0) return [];

  // подгружаем вложения одним запросом
  const ids = messages.map((m) => m.id);
  const placeholders = ids.map(() => "?").join(",");
  const attRes = await db.execute({
    sql: `SELECT id, message_id, filename, mime_type, size, kind, content_text, content_base64, created_at
          FROM chat_attachments WHERE message_id IN (${placeholders})`,
    args: ids,
  });
  const byMsg = new Map<string, ChatAttachment[]>();
  for (const r of attRes.rows as unknown as ChatAttachment[]) {
    const arr = byMsg.get(r.message_id) ?? [];
    arr.push(r);
    byMsg.set(r.message_id, arr);
  }
  for (const m of messages) m.attachments = byMsg.get(m.id) ?? [];
  return messages;
}

// ─── Настройки чата ──────────────────────────────────────────────────

export async function getSettings(): Promise<ChatSettings> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute(`SELECT system_prompt, enabled_blocks, updated_at FROM chat_settings WHERE id = 1`);
  const row = res.rows[0] as { system_prompt?: string; enabled_blocks?: string; updated_at?: string } | undefined;

  if (!row) {
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO chat_settings (id, system_prompt, enabled_blocks, created_at, updated_at)
            VALUES (1, ?, ?, ?, ?)`,
      args: [DEFAULT_SYSTEM_PROMPT, JSON.stringify(DEFAULT_ENABLED_BLOCKS), now, now],
    });
    return {
      system_prompt: DEFAULT_SYSTEM_PROMPT,
      enabled_blocks: DEFAULT_ENABLED_BLOCKS,
      updated_at: now,
    };
  }

  let enabled: EnabledBlocks = DEFAULT_ENABLED_BLOCKS;
  try {
    const parsed = JSON.parse(row.enabled_blocks ?? "{}");
    enabled = { ...DEFAULT_ENABLED_BLOCKS, ...parsed };
  } catch {
    // тихо: оставляем дефолт
  }
  return {
    system_prompt: row.system_prompt ?? DEFAULT_SYSTEM_PROMPT,
    enabled_blocks: enabled,
    updated_at: row.updated_at ?? new Date().toISOString(),
  };
}

export async function updateSettings(
  systemPrompt: string,
  enabledBlocks: EnabledBlocks,
): Promise<ChatSettings> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO chat_settings (id, system_prompt, enabled_blocks, created_at, updated_at)
          VALUES (1, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            system_prompt = excluded.system_prompt,
            enabled_blocks = excluded.enabled_blocks,
            updated_at = excluded.updated_at`,
    args: [systemPrompt, JSON.stringify(enabledBlocks), now, now],
  });
  return { system_prompt: systemPrompt, enabled_blocks: enabledBlocks, updated_at: now };
}

// ─── Сборка финального system-промта ────────────────────────────────

export function buildFormattingRules(blocks: EnabledBlocks): string {
  const allowed: string[] = [];
  const forbidden: string[] = [];

  (blocks.headings ? allowed : forbidden).push("заголовки ## и ###");
  (blocks.emphasis ? allowed : forbidden).push("**жирный** и *курсив*");
  (blocks.lists ? allowed : forbidden).push("маркированные и нумерованные списки");
  (blocks.tables ? allowed : forbidden).push("таблицы GFM (| ... |)");
  (blocks.code ? allowed : forbidden).push("блоки кода ```lang ... ``` и `inline-code`");
  (blocks.quotes ? allowed : forbidden).push("блоки цитат (> ...)");
  (blocks.hr ? allowed : forbidden).push("горизонтальный разделитель ---");
  (blocks.links ? allowed : forbidden).push("ссылки [текст](url)");
  (blocks.images ? allowed : forbidden).push("картинки ![alt](url)");

  const parts: string[] = [];
  parts.push(`Форматируй ответ как GitHub-flavored Markdown.`);
  if (allowed.length) parts.push(`Разрешено использовать: ${allowed.join("; ")}.`);
  if (forbidden.length) parts.push(`НЕ используй: ${forbidden.join("; ")}.`);
  return parts.join(" ");
}

export function buildSystemPrompt(
  settings: ChatSettings,
  options: { addon?: string | null } = {},
): string {
  const head = settings.system_prompt.trim();
  const rules = buildFormattingRules(settings.enabled_blocks);
  const addon = options.addon?.trim();
  return [head, addon, rules].filter(Boolean).join("\n\n");
}

// ─── Конструктор контента в формате AIMLAPI ──────────────────────────

export interface BuiltMessage {
  role: ChatRole;
  content: unknown;
}

export function buildMessagesForModel(
  systemPrompt: string,
  history: ChatMessage[],
  modelId: string,
): BuiltMessage[] {
  const opt = getModelOption(modelId);
  const out: BuiltMessage[] = [];
  if (systemPrompt) out.push({ role: "system", content: systemPrompt });

  for (const m of history) {
    if (m.role === "system") continue;
    const atts = m.attachments ?? [];

    const textBlock = atts
      .filter((a) => a.kind === "text" && a.content_text != null)
      .map(
        (a) =>
          `\n\n--- Файл: ${a.filename} (${a.mime_type}, ${a.size} байт) ---\n` +
          truncateForPrompt(a.content_text ?? "") +
          `\n--- конец файла ---`,
      )
      .join("");

    const combinedText = (m.content || "") + textBlock;
    const images = atts.filter((a) => a.kind === "image" && a.content_base64);

    if (opt.multimodal && images.length > 0 && m.role === "user") {
      const parts: Array<Record<string, unknown>> = [];
      if (combinedText.trim()) parts.push({ type: "text", text: combinedText });
      for (const img of images) {
        parts.push({
          type: "image_url",
          image_url: { url: `data:${img.mime_type};base64,${img.content_base64}` },
        });
      }
      out.push({ role: m.role, content: parts });
    } else {
      let txt = combinedText;
      if (!opt.multimodal && images.length > 0) {
        txt += `\n\n[Прикреплено ${images.length} изображени${images.length === 1 ? "е" : "я"}, но выбранная модель не умеет их читать.]`;
      }
      out.push({ role: m.role, content: txt });
    }
  }

  return normalizeAlternating(out);
}

/** Гарантируем строгое чередование user/assistant после system-блока.
 *
 *  Perplexity Sonar (и не только) кидает 400 «After the (optional) system
 *  message(s), user or tool message(s) should alternate with assistant
 *  message(s)», если в истории есть `user user` или `assistant assistant`
 *  подряд. Такое случается при race-condition фронта (двойной Send), или
 *  при отменённом запросе (assistant не записался), или при параллельных
 *  вкладках.
 *
 *  Стратегия: если несколько сообщений одной роли идут подряд — оставляем
 *  ПОСЛЕДНЕЕ. Предыдущие повторы — это либо "то же самое два раза", либо
 *  потерянный контекст, который уже не вернуть. Меньшее зло, чем 400.
 *  Системные сообщения наверху не трогаем. */
function normalizeAlternating(msgs: BuiltMessage[]): BuiltMessage[] {
  const out: BuiltMessage[] = [];
  for (const m of msgs) {
    if (m.role === "system") {
      out.push(m);
      continue;
    }
    // Если непосредственно предыдущее сообщение в out — той же роли,
    // заменяем его на текущее. Иначе — добавляем. Так гарантируем
    // строгое чередование без потери system-сообщений между блоками.
    if (out.length > 0 && out[out.length - 1].role === m.role) {
      out[out.length - 1] = m;
    } else {
      out.push(m);
    }
  }
  return out;
}

function truncateForPrompt(s: string, limit = 60_000): string {
  if (s.length <= limit) return s;
  return s.slice(0, limit) + `\n\n[…усечено, всего ${s.length} символов]`;
}
