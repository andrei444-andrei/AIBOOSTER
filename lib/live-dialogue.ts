// Модуль «Английский» → «Живой диалог» (live voice conversation).
//
// Голосовая практика: AI задаёт вопрос (быстрая модель) → озвучивает (flash
// TTS) → пользователь отвечает голосом → сервер транскрибирует (STT) →
// оценивает (быстрая модель) → продолжает или объясняет грубую ошибку.
//
// Скорость — приоритет: всюду flash-модели, подсказка генерится вместе с
// вопросом (мгновенная «Помощь»), аудио отдаётся инлайном (base64). Аудио
// реплик не храним — только транскрипты/вердикты/причины (лог + персонализация).

import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "./db";
import { chatJson } from "./aimlapi";
import { ttsSynth } from "./pipeline/aimlapi";

// Быстрые модели (скорость в приоритете).
const CHAT_MODEL = process.env.LIVE_DIALOGUE_MODEL || "gemini-2.5-flash";
// eleven_turbo_v2_5 — низкая задержка, доступна на aimlapi (flash_v2_5 там 404).
const TTS_MODEL = process.env.LIVE_TTS_MODEL || "elevenlabs/eleven_turbo_v2_5";
const TTS_VOICE = process.env.LIVE_DIALOGUE_VOICE || "Rachel";
// STT через aimlapi (async create+poll). Не зависим от прямого OpenAI-ключа
// (он на проде упирался в 429). whisper-large устойчив к акценту учащегося.
const AIML_BASE = "https://api.aimlapi.com/v1";
const STT_MODEL = process.env.LIVE_STT_AIML_MODEL || "#g1_whisper-large";

export type Verdict = "ok" | "minor" | "gross" | "skip";

export interface Suggestion {
  en: string;
  ru: string;
}

export interface SessionRow {
  id: string;
  topic: string;
  status: "active" | "finished";
  turn_count: number;
  ok_count: number;
  error_count: number;
  current_idx: number;
  current_question: string | null;
  current_suggestion: string | null; // JSON Suggestion
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface TurnRow {
  id: string;
  session_id: string;
  idx: number;
  ai_text: string;
  user_transcript: string | null;
  verdict: Verdict | null;
  error_reason: string | null;
  correction: string | null;
  created_at: string;
}

// --- TTS: озвучка реплики → data-URI (инлайн, без хранилища). ---
export async function synthSpeech(text: string): Promise<string | null> {
  try {
    const buf = await ttsSynth(text, { voice: TTS_VOICE, model: TTS_MODEL });
    return `data:audio/mpeg;base64,${Buffer.from(buf).toString("base64")}`;
  } catch {
    // Озвучка не критична: если TTS упал — вернём текст, клиент покажет без аудио.
    return null;
  }
}

// --- STT через aimlapi (create → poll). Кидает ошибку при сбое распознавания
// (вызывающий отличает «тех. сбой» от «тишины/пустого ответа»). ---
export async function transcribeViaAimlapi(audio: Blob, filename: string): Promise<string> {
  const key = process.env.AIMLAPI_KEY;
  if (!key) throw new Error("AIMLAPI_KEY is not set");
  const fd = new FormData();
  fd.append("model", STT_MODEL);
  fd.append("audio", audio, filename);
  const c = await fetch(`${AIML_BASE}/stt/create`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: fd,
  });
  if (!c.ok) throw new Error(`stt create ${c.status}: ${(await c.text().catch(() => "")).slice(0, 200)}`);
  const cj = (await c.json()) as Record<string, unknown>;
  const gid = (cj.generation_id || cj.id || cj.gen_id) as string | undefined;
  if (!gid) throw new Error("stt: no generation_id");

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    const g = await fetch(`${AIML_BASE}/stt/${gid}`, { headers: { authorization: `Bearer ${key}` } });
    if (!g.ok) continue;
    const gj = (await g.json()) as Record<string, unknown>;
    const st = String(gj.status ?? "");
    if (st === "completed" || st === "complete" || st === "succeeded" || st === "done" || gj.result) {
      return extractTranscript(gj);
    }
    if (st === "error" || st === "failed") {
      throw new Error(`stt failed: ${JSON.stringify(gj).slice(0, 200)}`);
    }
  }
  throw new Error("stt timeout");
}

function extractTranscript(gj: Record<string, unknown>): string {
  try {
    const t = (gj as { result?: { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } } })
      .result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    if (typeof t === "string") return t.trim();
  } catch {
    /* fallthrough */
  }
  const s = JSON.stringify(gj);
  const m = s.match(/"transcript":"([^"]*)"/) || s.match(/"text":"([^"]*)"/);
  return m ? m[1].trim() : "";
}

// --- Сессии ---
export async function createSession(topic: string): Promise<SessionRow> {
  await ensureSchema();
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO live_dialogue_sessions (id, topic, status, created_at, updated_at)
          VALUES (?, ?, 'active', ?, ?)`,
    args: [id, topic, now, now],
  });
  const row = await getSession(id);
  if (!row) throw new Error("session not found after insert");
  return row;
}

export async function getSession(id: string): Promise<SessionRow | null> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM live_dialogue_sessions WHERE id = ?`,
    args: [id],
  });
  return (res.rows[0] as unknown as SessionRow) ?? null;
}

export async function getTurns(sessionId: string): Promise<TurnRow[]> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM live_dialogue_turns WHERE session_id = ? ORDER BY idx ASC, created_at ASC`,
    args: [sessionId],
  });
  return res.rows as unknown as TurnRow[];
}

export interface SessionSummary {
  id: string;
  topic: string;
  status: "active" | "finished";
  turn_count: number;
  ok_count: number;
  error_count: number;
  created_at: string;
}

export async function listSessions(
  status: "active" | "finished" | "all" = "all",
): Promise<SessionSummary[]> {
  await ensureSchema();
  const db = getDb();
  const where = status === "all" ? "" : "WHERE status = ?";
  const args = status === "all" ? [] : [status];
  const res = await db.execute({
    sql: `SELECT id, topic, status, turn_count, ok_count, error_count, created_at
          FROM live_dialogue_sessions ${where}
          ORDER BY created_at DESC LIMIT 200`,
    args,
  });
  return res.rows as unknown as SessionSummary[];
}

// Сохраняет текущий вопрос AI на сессию (на него оценивается следующий ответ).
async function setCurrentQuestion(
  sessionId: string,
  idx: number,
  question: string,
  suggestion: Suggestion,
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE live_dialogue_sessions
          SET current_idx = ?, current_question = ?, current_suggestion = ?,
              turn_count = ?, updated_at = ?
          WHERE id = ?`,
    args: [idx, question, JSON.stringify(suggestion), idx + 1, new Date().toISOString(), sessionId],
  });
}

async function logTurn(args: {
  sessionId: string;
  idx: number;
  aiText: string;
  transcript: string;
  verdict: Verdict;
  errorReason?: string | null;
  correction?: string | null;
}): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO live_dialogue_turns
            (id, session_id, idx, ai_text, user_transcript, verdict, error_reason, correction, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      randomUUID(),
      args.sessionId,
      args.idx,
      args.aiText,
      args.transcript,
      args.verdict,
      args.errorReason ?? null,
      args.correction ?? null,
      new Date().toISOString(),
    ],
  });
}

async function bumpCounts(sessionId: string, field: "ok_count" | "error_count"): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE live_dialogue_sessions SET ${field} = ${field} + 1, updated_at = ? WHERE id = ?`,
    args: [new Date().toISOString(), sessionId],
  });
}

export async function finishSession(sessionId: string): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE live_dialogue_sessions SET status = 'finished', finished_at = ?, updated_at = ? WHERE id = ?`,
    args: [now, now, sessionId],
  });
}

// Недавние причины грубых ошибок (для персонализации новых сессий).
async function recentErrorReasons(limit = 8): Promise<string[]> {
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT error_reason FROM live_dialogue_turns
          WHERE verdict = 'gross' AND error_reason IS NOT NULL
          ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return res.rows.map((r) => String(r.error_reason)).filter(Boolean);
}

function pastErrorsBlock(errors: string[]): string {
  if (errors.length === 0) return "";
  return (
    `\nLearner's recent recurring mistakes (gently keep these in mind, don't lecture):\n` +
    errors.slice(0, 6).map((e) => `- ${e}`).join("\n")
  );
}

// Компактная история диалога (принятые обмены) для связности.
function buildHistory(turns: TurnRow[]): string {
  const lines: string[] = [];
  const seen = new Set<number>();
  for (const t of turns) {
    if (t.verdict === "ok" || t.verdict === "minor") {
      if (seen.has(t.idx)) continue;
      seen.add(t.idx);
      lines.push(`AI: ${t.ai_text}`);
      if (t.user_transcript) lines.push(`Learner: ${t.user_transcript}`);
    }
  }
  return lines.slice(-12).join("\n");
}

// --- Генерация первого вопроса ---
export async function generateOpening(
  topic: string,
): Promise<{ question: string; suggestion: Suggestion }> {
  const errors = await recentErrorReasons();
  const system =
    `You are a friendly English conversation partner for a Russian-speaking learner (level A2–B2). ` +
    `Start a natural spoken conversation on the given topic. Ask ONE short, clear opening question ` +
    `(it will be read aloud, so keep it speakable, max ~20 words). Also give a suggested answer the ` +
    `learner could say. Reply STRICT JSON: ` +
    `{"question": string, "suggestion": {"en": string, "ru": string}} where suggestion.en is a short ` +
    `natural answer in English and suggestion.ru is its Russian translation. No text outside JSON.` +
    pastErrorsBlock(errors);
  const user = `Topic: "${topic}". Ask the opening question.`;
  const { parsed } = await chatJson<unknown>({
    model: CHAT_MODEL,
    system,
    user,
    temperature: 0.7,
    maxTokens: 600,
    timeoutMs: 30_000,
  });
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const question = typeof o.question === "string" && o.question.trim() ? o.question.trim() : `Let's talk about ${topic}. What do you think about it?`;
  return { question, suggestion: normalizeSuggestion(o.suggestion) };
}

export interface EvalResult {
  verdict: Verdict;
  errorReason: string | null;
  corrected: string | null;
  nextQuestion: string | null;
  nextSuggestion: Suggestion | null;
}

// --- Оценка ответа + продолжение ---
export async function evaluateAnswer(args: {
  topic: string;
  aiQuestion: string;
  transcript: string;
  history: string;
}): Promise<EvalResult> {
  const errors = await recentErrorReasons();
  const system =
    `You are an encouraging English speaking coach in a LIVE voice conversation with a Russian-speaking ` +
    `learner (A2–B2). The learner's answer comes from speech-to-text and may contain minor transcription ` +
    `noise — do NOT penalize plausible mishearings. Judge whether the answer is an acceptable spoken reply ` +
    `to the AI's question.\n` +
    `- "ok": communicates the meaning; small slips fine.\n` +
    `- "minor": understandable but with a noticeable slip (still continue).\n` +
    `- "gross": serious grammar/meaning error, or off-topic/irrelevant answer.\n` +
    `- "skip": empty, nonsensical, or clearly not an attempt.\n` +
    `Be lenient and supportive — prefer continuing the conversation.\n` +
    `If ok/minor: produce a natural SHORT follow-up question (speakable, ~max 20 words) and a suggested answer.\n` +
    `ALWAYS include "corrected": the learner's answer rewritten in correct, natural English (keep their meaning; ` +
    `if it is already correct, return it unchanged).\n` +
    `If gross: also "error_reason" in RUSSIAN (1–2 sentences: what's wrong and why).\n` +
    `Reply STRICT JSON: {"verdict":"ok|minor|gross|skip","corrected":string,"error_reason":string|null,` +
    `"next_question":string|null,"next_suggestion":{"en":string,"ru":string}|null}. No text outside JSON.` +
    pastErrorsBlock(errors);
  const user =
    `Topic: "${args.topic}".\n` +
    (args.history ? `Conversation so far:\n${args.history}\n\n` : "") +
    `AI's current question: "${args.aiQuestion}"\n` +
    `Learner's spoken answer (STT): "${args.transcript}"\n\n` +
    `Evaluate and reply JSON.`;
  const { parsed } = await chatJson<unknown>({
    model: CHAT_MODEL,
    system,
    user,
    temperature: 0.5,
    maxTokens: 700,
    timeoutMs: 30_000,
  });
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const verdict = normalizeVerdict(o.verdict);
  return {
    verdict,
    errorReason: typeof o.error_reason === "string" ? o.error_reason.trim() || null : null,
    corrected: typeof o.corrected === "string" ? o.corrected.trim() || null : null,
    nextQuestion: typeof o.next_question === "string" ? o.next_question.trim() || null : null,
    nextSuggestion: o.next_suggestion ? normalizeSuggestion(o.next_suggestion) : null,
  };
}

function normalizeVerdict(v: unknown): Verdict {
  return v === "ok" || v === "minor" || v === "gross" || v === "skip" ? v : "minor";
}

function normalizeSuggestion(raw: unknown): Suggestion {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return {
      en: typeof o.en === "string" ? o.en.trim() : "",
      ru: typeof o.ru === "string" ? o.ru.trim() : "",
    };
  }
  if (typeof raw === "string") return { en: raw.trim(), ru: "" };
  return { en: "", ru: "" };
}

// Высокоуровневые операции для роутов:

// Стартовое состояние сессии: генерим первый вопрос, озвучиваем, сохраняем.
export async function startSession(topic: string): Promise<{
  session: SessionRow;
  aiText: string;
  aiAudio: string | null;
  suggestion: Suggestion;
}> {
  const session = await createSession(topic);
  const { question, suggestion } = await generateOpening(topic);
  await setCurrentQuestion(session.id, 0, question, suggestion);
  const aiAudio = await synthSpeech(question);
  return { session, aiText: question, aiAudio, suggestion };
}

export interface AnswerOutcome {
  verdict: Verdict;
  transcript: string;
  // ok/minor:
  aiText?: string;
  aiAudio?: string | null;
  suggestion?: Suggestion;
  // правка ответа (для любого вердикта — для ленты с красным diff). null/пусто,
  // если правка не нужна (ответ уже корректен).
  corrected?: string | null;
  // gross:
  errorReason?: string;
  correctionAudio?: string | null;
  // skip:
  repeatText?: string;
}

// Обрабатывает ответ пользователя: оценка + продолжение/коррекция/повтор.
export async function processAnswer(
  session: SessionRow,
  transcript: string,
): Promise<AnswerOutcome> {
  const aiQuestion = session.current_question ?? "";
  const cleaned = transcript.trim();

  // Пустой/слишком короткий ответ — просим повторить, без штрафа.
  if (cleaned.length < 2) {
    await logTurn({
      sessionId: session.id,
      idx: session.current_idx,
      aiText: aiQuestion,
      transcript: cleaned,
      verdict: "skip",
    });
    return { verdict: "skip", transcript: cleaned, repeatText: aiQuestion };
  }

  const turns = await getTurns(session.id);
  const history = buildHistory(turns);
  const evalRes = await evaluateAnswer({
    topic: session.topic,
    aiQuestion,
    transcript: cleaned,
    history,
  });

  // Исправленную версию пишем в лог только если она реально отличается.
  const correctedDiffers =
    !!evalRes.corrected && evalRes.corrected.toLowerCase().trim() !== cleaned.toLowerCase().trim();

  await logTurn({
    sessionId: session.id,
    idx: session.current_idx,
    aiText: aiQuestion,
    transcript: cleaned,
    verdict: evalRes.verdict,
    errorReason: evalRes.errorReason,
    correction: correctedDiffers ? evalRes.corrected : null,
  });

  if (evalRes.verdict === "skip") {
    return { verdict: "skip", transcript: cleaned, repeatText: aiQuestion };
  }

  if (evalRes.verdict === "gross") {
    await bumpCounts(session.id, "error_count");
    const reason = evalRes.errorReason || "Ответ содержит ошибку. Попробуй ещё раз.";
    const corrected = evalRes.corrected || "";
    const speak = corrected ? `${corrected}. Try again.` : `Let's try that again.`;
    const correctionAudio = await synthSpeech(speak);
    return {
      verdict: "gross",
      transcript: cleaned,
      errorReason: reason,
      corrected,
      correctionAudio,
    };
  }

  // ok / minor → продолжаем
  await bumpCounts(session.id, "ok_count");
  const nextQuestion =
    evalRes.nextQuestion || "Nice. Can you tell me a bit more?";
  const nextSuggestion = evalRes.nextSuggestion || { en: "", ru: "" };
  await setCurrentQuestion(session.id, session.current_idx + 1, nextQuestion, nextSuggestion);
  const aiAudio = await synthSpeech(nextQuestion);
  return {
    verdict: evalRes.verdict,
    transcript: cleaned,
    corrected: correctedDiffers ? evalRes.corrected : null,
    aiText: nextQuestion,
    aiAudio,
    suggestion: nextSuggestion,
  };
}
