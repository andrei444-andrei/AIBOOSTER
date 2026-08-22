// Модуль «Английский» → подраздел «Build sentences» (собери предложение).
//
// CRUD над english_sentence_tasks / english_sentence_items + генерация
// контента одним вызовом LLM (без аудио — поэтому без воркера/ffmpeg).

import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "./db";
import { chatJson } from "./aimlapi";
import { logError } from "./logger";

export type TaskStatus = "generating" | "ready" | "failed";

export interface Chunk {
  text: string;
  tr: string;
}

export interface TaskRow {
  id: string;
  topic: string;
  title: string | null;
  status: TaskStatus;
  error_message: string | null;
  error_id: string | null;
  total: number;
  done: number; // 0 | 1
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface ItemRow {
  task_id: string;
  idx: number;
  en_text: string;
  ru_text: string | null;
  chunks: string; // JSON Chunk[]
  memo: string | null;
  completed: number; // 0 | 1
}

const TARGET_SENTENCES = 10;

export async function createTask(topic: string): Promise<TaskRow> {
  await ensureSchema();
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO english_sentence_tasks (id, topic, status, created_at, updated_at)
          VALUES (?, ?, 'generating', ?, ?)`,
    args: [id, topic, now, now],
  });
  const row = await getTask(id);
  if (!row) throw new Error("task not found after insert");
  return row;
}

export async function getTask(id: string): Promise<TaskRow | null> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM english_sentence_tasks WHERE id = ?`,
    args: [id],
  });
  return (res.rows[0] as unknown as TaskRow) ?? null;
}

export async function getItems(taskId: string): Promise<ItemRow[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT task_id, idx, en_text, ru_text, chunks, memo, completed
          FROM english_sentence_items WHERE task_id = ? ORDER BY idx ASC`,
    args: [taskId],
  });
  return res.rows as unknown as ItemRow[];
}

export interface TaskSummary {
  id: string;
  topic: string;
  title: string | null;
  status: TaskStatus;
  total: number;
  done: number;
  completed_count: number;
  created_at: string;
}

export async function listTasks(
  section: "todo" | "done" | "all" = "all",
): Promise<TaskSummary[]> {
  await ensureSchema();
  const db = getDb();
  const where =
    section === "todo" ? "WHERE t.done = 0" : section === "done" ? "WHERE t.done = 1" : "";
  const res = await db.execute(
    `SELECT t.id, t.topic, t.title, t.status, t.total, t.done, t.created_at,
            (SELECT COUNT(*) FROM english_sentence_items i
               WHERE i.task_id = t.id AND i.completed = 1) AS completed_count
     FROM english_sentence_tasks t
     ${where}
     ORDER BY t.created_at DESC
     LIMIT 200`,
  );
  return res.rows as unknown as TaskSummary[];
}

// Отмечает предложение собранным и пересчитывает done у задания. Возвращает
// актуальные счётчики (для авто-переноса в «Сделано» на клиенте).
export async function markItemCompleted(
  taskId: string,
  idx: number,
): Promise<{ done: boolean; completed: number; total: number }> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE english_sentence_items SET completed = 1 WHERE task_id = ? AND idx = ?`,
    args: [taskId, idx],
  });
  const cnt = await db.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM english_sentence_items WHERE task_id = ?) AS total,
            (SELECT COUNT(*) FROM english_sentence_items WHERE task_id = ? AND completed = 1) AS done_cnt`,
    args: [taskId, taskId],
  });
  const total = Number(cnt.rows[0]?.total ?? 0);
  const completed = Number(cnt.rows[0]?.done_cnt ?? 0);
  const allDone = total > 0 && completed >= total;
  await db.execute({
    sql: `UPDATE english_sentence_tasks SET done = ?, updated_at = ? WHERE id = ?`,
    args: [allDone ? 1 : 0, now, taskId],
  });
  return { done: allDone, completed, total };
}

interface GenSentence {
  en: string;
  ru: string;
  chunks: Chunk[];
  memo: string;
}

// Генерация контента задания одним вызовом LLM. Запускается в фоне (waitUntil)
// после создания задачи. Ошибки ловит сам и помечает задачу failed.
export async function generateTaskContent(taskId: string, topic: string): Promise<void> {
  const db = getDb();
  try {
    const { title, sentences } = await generateSentences(topic);
    if (sentences.length === 0) throw new Error("LLM не вернул предложений");

    const now = new Date().toISOString();
    const statements = [
      { sql: `DELETE FROM english_sentence_items WHERE task_id = ?`, args: [taskId] },
      ...sentences.map((s, i) => ({
        sql: `INSERT INTO english_sentence_items
                (task_id, idx, en_text, ru_text, chunks, memo, completed)
              VALUES (?, ?, ?, ?, ?, ?, 0)`,
        args: [taskId, i, s.en, s.ru, JSON.stringify(s.chunks), s.memo],
      })),
    ];
    await db.batch(statements, "write");
    await db.execute({
      sql: `UPDATE english_sentence_tasks
            SET status = 'ready', title = ?, total = ?, updated_at = ?, finished_at = ?
            WHERE id = ?`,
      args: [title, sentences.length, now, now, taskId],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorId = await logError({
      level: "error",
      source: "server",
      route: "/api/english-sentences (generate)",
      message,
      stack: err instanceof Error ? err.stack ?? null : null,
      meta: { task_id: taskId, topic },
    });
    await db
      .execute({
        sql: `UPDATE english_sentence_tasks
              SET status = 'failed', error_message = ?, error_id = ?, updated_at = ?, finished_at = ?
              WHERE id = ?`,
        args: [message.slice(0, 1000), errorId, new Date().toISOString(), new Date().toISOString(), taskId],
      })
      .catch(() => {});
  }
}

async function generateSentences(
  topic: string,
): Promise<{ title: string; sentences: GenSentence[] }> {
  const system =
    `Ты создаёшь упражнения «собери предложение» для изучающих английский (уровень A2–B2). ` +
    `Сгенерируй РОВНО ${TARGET_SENTENCES} предложений по теме. Разнообразь грамматику ` +
    `(разные времена, вопросы, отрицания, модальные, конструкции). Для КАЖДОГО предложения дай:\n` +
    `- "en": корректное английское предложение;\n` +
    `- "ru": его естественный русский перевод;\n` +
    `- "chunks": массив из 4–7 кусков в ПРАВИЛЬНОМ порядке — каждый кусок это слово или ` +
    `короткая осмысленная группа слов (член предложения). Каждый кусок: {"text": кусок по-английски, ` +
    `"tr": краткий перевод этого куска на русский}. Конкатенация text всех кусков через пробел = "en";\n` +
    `- "memo": памятка на русском 200–300 символов — объясни СТРУКТУРУ и порядок слов именно этого ` +
    `предложения (какое время/конструкция, почему такой порядок). Без воды.\n\n` +
    `Ответ — СТРОГО JSON: {"title": краткий заголовок темы, "sentences": [{"en","ru","chunks":[{"text","tr"}],"memo"}]}. ` +
    `Никакого текста вне JSON.`;
  const user = `Тема: "${topic}". Сгенерируй ${TARGET_SENTENCES} предложений.`;

  const { parsed } = await chatJson<unknown>({
    model: process.env.AIMLAPI_CHAT_MODEL || "gpt-4o",
    system,
    user,
    temperature: 0.7,
    maxTokens: 8000,
    timeoutMs: 120_000,
  });

  return normalize(parsed, topic);
}

function normalize(parsed: unknown, topic: string): { title: string; sentences: GenSentence[] } {
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const title =
    typeof obj.title === "string" && obj.title.trim() ? obj.title.trim().slice(0, 120) : topic.slice(0, 80);
  const raw = (obj.sentences ?? obj.items ?? obj.data) as unknown;
  const out: GenSentence[] = [];
  if (Array.isArray(raw)) {
    for (const s of raw) {
      if (!s || typeof s !== "object") continue;
      const so = s as Record<string, unknown>;
      const en = typeof so.en === "string" ? so.en.trim() : "";
      if (!en) continue;
      const ru = typeof so.ru === "string" ? so.ru.trim() : "";
      const memo = typeof so.memo === "string" ? so.memo.trim() : "";
      const chunks = normalizeChunks(so.chunks, en);
      if (chunks.length < 2) continue; // нечего собирать
      out.push({ en, ru, chunks, memo });
    }
  }
  return { title, sentences: out };
}

function normalizeChunks(raw: unknown, en: string): Chunk[] {
  const chunks: Chunk[] = [];
  if (Array.isArray(raw)) {
    for (const c of raw) {
      if (typeof c === "string") {
        if (c.trim()) chunks.push({ text: c.trim(), tr: "" });
      } else if (c && typeof c === "object") {
        const co = c as Record<string, unknown>;
        const text = typeof co.text === "string" ? co.text.trim() : "";
        const tr = typeof co.tr === "string" ? co.tr.trim() : "";
        if (text) chunks.push({ text, tr });
      }
    }
  }
  // Фолбэк: если модель не дала куски — режем по словам.
  if (chunks.length < 2) {
    return en
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => ({ text: w, tr: "" }));
  }
  return chunks;
}
