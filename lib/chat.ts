import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "./db";
import { DEFAULT_MODEL } from "./ai";
import {
  MODEL_OPTIONS,
  getModelOption,
  isKnownModel,
  DEFAULT_ENABLED_BLOCKS,
  type EnabledBlocks,
  type ModelOption,
} from "./chat-client";

export { MODEL_OPTIONS, getModelOption, isKnownModel, DEFAULT_ENABLED_BLOCKS };
export type { EnabledBlocks, ModelOption };

// ─── Типы ────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  uid: string;
  title: string;
  model: string;
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
  kind: "text" | "image";
  content_text: string | null;
  content_base64: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  model: string | null;
  tokens_prompt: number | null;
  tokens_completion: number | null;
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

export async function createSession(
  uid: string,
  model: string = DEFAULT_MODEL,
  title = "Новый чат",
): Promise<ChatSession> {
  await ensureSchema();
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO chat_sessions (id, uid, title, model, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, uid, title, model, now, now],
  });
  return { id, uid, title, model, created_at: now, updated_at: now };
}

export async function listSessions(uid: string, limit = 100): Promise<ChatSession[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT id, uid, title, model, created_at, updated_at
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
    sql: `SELECT id, uid, title, model, created_at, updated_at
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
  // удаляем сообщения и вложения тоже — самопровижининг без FK, но логически связано
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

export async function setSessionModel(id: string, uid: string, model: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE chat_sessions SET model = ?, updated_at = ? WHERE id = ? AND uid = ?`,
    args: [model, new Date().toISOString(), id, uid],
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
  kind: "text" | "image";
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
    attachments?: CreateAttachmentInput[];
  } = {},
): Promise<ChatMessage> {
  await ensureSchema();
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO chat_messages
            (id, session_id, role, content, model, tokens_prompt, tokens_completion, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      sessionId,
      role,
      content,
      opts.model ?? null,
      opts.tokensPrompt ?? null,
      opts.tokensCompletion ?? null,
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
    created_at: now,
    attachments,
  };
}

export async function listMessages(sessionId: string): Promise<ChatMessage[]> {
  await ensureSchema();
  const db = getDb();
  const msgs = await db.execute({
    sql: `SELECT id, session_id, role, content, model, tokens_prompt, tokens_completion, created_at
          FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`,
    args: [sessionId],
  });
  const messages = msgs.rows as unknown as ChatMessage[];
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
    // первая инициализация — пишем дефолты
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
  // upsert: гарантируем строку с id=1
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

export function buildSystemPrompt(settings: ChatSettings): string {
  const head = settings.system_prompt.trim();
  const rules = buildFormattingRules(settings.enabled_blocks);
  return [head, rules].filter(Boolean).join("\n\n");
}

// ─── Конструктор контента в формате AIMLAPI ──────────────────────────
//
// Для multimodal-моделей контент user-сообщения — массив частей
// [{ type: "text", text }, { type: "image_url", image_url: { url } }, ...].
// Для не-multimodal моделей картинки игнорируем, всё схлопываем в строку.

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

    // текстовые вложения — всегда инлайнятся в текст
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

  return out;
}

// Усечение длинных файлов, чтобы не сжечь контекст модели.
function truncateForPrompt(s: string, limit = 60_000): string {
  if (s.length <= limit) return s;
  return s.slice(0, limit) + `\n\n[…усечено, всего ${s.length} символов]`;
}
