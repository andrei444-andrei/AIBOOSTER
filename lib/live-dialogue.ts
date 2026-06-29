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
// gpt-4o-mini надёжнее держит JSON-схему (gemini-flash временами ронял
// next_question/corrected → терялась нить). Так же быстр.
const CHAT_MODEL = process.env.LIVE_DIALOGUE_MODEL || "gpt-4o-mini";
// eleven_turbo_v2_5 — низкая задержка, доступна на aimlapi (flash_v2_5 там 404).
const TTS_MODEL = process.env.LIVE_TTS_MODEL || "elevenlabs/eleven_turbo_v2_5";
const TTS_VOICE = process.env.LIVE_DIALOGUE_VOICE || "Rachel";
// STT: Deepgram (синхронный HTTP, ~0.3–0.5с) — основной путь, если задан ключ.
// Async-STT aimlapi (~5с из-за их очереди, проверено замерами) остаётся
// фолбэком, когда DEEPGRAM_API_KEY не задан.
const AIML_BASE = "https://api.aimlapi.com/v1";
const STT_MODEL = process.env.LIVE_STT_AIML_MODEL || "#g1_whisper-large";
const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY;
const DG_MODEL = process.env.LIVE_STT_DEEPGRAM_MODEL || "nova-2";
// Речь учащегося — английская (главный сценарий практики). Фиксируем язык:
// для коротких реплик это точнее, чем авто-детект.
const DG_LANG = process.env.LIVE_STT_LANG || "en";

// Структура миссии: диалог конечен (7–15 ходов) и ведёт к цели.
const MIN_TURNS = 7;
const MAX_TURNS = 15;
const clampN = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export type Verdict = "ok" | "minor" | "gross" | "skip" | "clarify";

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
  goal: string | null;
  goal_ru: string | null;
  role_desc: string | null;
  beats_json: string | null; // JSON string[]
  beats_done: number;
  target_turns: number;
  ended_reason: string | null;
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

// --- STT через Deepgram (синхронный, низкая задержка). Принимает контейнер
// браузера как есть (webm/opus с Android/desktop, mp4/m4a с iOS) — Deepgram
// определяет формат сам. Кидает ошибку при сбое (вызывающий отличает от тишины). ---
async function transcribeViaDeepgram(audio: Blob, mime: string): Promise<string> {
  const key = DEEPGRAM_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set");
  const params = new URLSearchParams({
    model: DG_MODEL,
    language: DG_LANG,
    smart_format: "true",
    punctuate: "true",
  });
  const body = Buffer.from(await audio.arrayBuffer());
  const r = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
    method: "POST",
    headers: { authorization: `Token ${key}`, "content-type": mime || "audio/webm" },
    body,
  });
  if (!r.ok) throw new Error(`deepgram ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const j = (await r.json()) as Record<string, unknown>;
  const t = (j as { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } })
    .results?.channels?.[0]?.alternatives?.[0]?.transcript;
  return typeof t === "string" ? t.trim() : "";
}

// Единая точка распознавания: Deepgram (быстро) если задан ключ, иначе
// aimlapi async (фолбэк). Меняет провайдера без правок в роуте.
export async function transcribeSpeech(audio: Blob, filename: string, mime: string): Promise<string> {
  if (DEEPGRAM_KEY) return transcribeViaDeepgram(audio, mime);
  return transcribeViaAimlapi(audio, filename);
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

function parseBeats(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.map((s) => String(s)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// ok/minor: переход к следующей реплике — сдвигаем idx, пишем вопрос/подсказку,
// прогресс бет, счётчик ходов и ok_count одним апдейтом.
async function advanceTurn(args: {
  sessionId: string;
  nextIdx: number;
  question: string;
  suggestion: Suggestion;
  beatsDone: number;
  turnCount: number;
}): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE live_dialogue_sessions
          SET current_idx = ?, current_question = ?, current_suggestion = ?,
              beats_done = ?, turn_count = ?, ok_count = ok_count + 1, updated_at = ?
          WHERE id = ?`,
    args: [args.nextIdx, args.question, JSON.stringify(args.suggestion), args.beatsDone, args.turnCount, new Date().toISOString(), args.sessionId],
  });
}

// Завершение сессии: фиксируем прогресс/счётчик, ставим finished + причину.
async function finalizeSession(args: {
  sessionId: string;
  beatsDone: number;
  turnCount: number;
  endedReason: string;
  bumpOk: boolean;
}): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE live_dialogue_sessions
          SET beats_done = ?, turn_count = ?,${args.bumpOk ? " ok_count = ok_count + 1," : ""} status = 'finished', finished_at = ?, ended_reason = ?, updated_at = ?
          WHERE id = ?`,
    args: [args.beatsDone, args.turnCount, now, args.endedReason, now, args.sessionId],
  });
}

// Финальная реплика: самораскрытие-прощание, иначе перепрофилируем вопрос, иначе фолбэк.
function pickFinal(share: string, nextQuestion: string | null): string {
  return (share && share.trim()) || (nextQuestion && nextQuestion.trim()) || "It was lovely talking with you. Take care!";
}

// Обновляет только текст текущего вопроса (для переспроса «clarify») — idx и
// счётчики не трогаем: это та же логическая реплика, просто переформулирована.
async function updateCurrentQuestionText(sessionId: string, question: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE live_dialogue_sessions SET current_question = ?, updated_at = ? WHERE id = ?`,
    args: [question, new Date().toISOString(), sessionId],
  });
}

function parseSuggestionStr(raw: string | null): Suggestion {
  if (!raw) return { en: "", ru: "" };
  try {
    return normalizeSuggestion(JSON.parse(raw));
  } catch {
    return { en: "", ru: "" };
  }
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

// --- Генерация плана миссии + первой реплики ---
export interface DialoguePlan {
  roleDesc: string;
  goal: string;
  goalRu: string;
  beats: string[];
  targetTurns: number;
  question: string;
  suggestion: Suggestion;
}

const FALLBACK_BEATS = [
  "Find out what the learner wants or thinks",
  "Ask a follow-up about a detail they mention",
  "Develop the topic a little further",
  "Move the conversation toward the goal",
  "Wrap up warmly and say goodbye",
];

function looksLikeGoodbye(s: string): boolean {
  return /goodbye|farewell|wrap|\bbye\b|finish|leav|see you|take care|thank/i.test(s || "");
}

// Нормализация чеклиста бет: 3–7 штук, последняя всегда — прощание.
function normalizeBeats(raw: unknown): string[] {
  let beats = Array.isArray(raw) ? raw.map((s) => String(s).trim()).filter(Boolean) : [];
  if (beats.length < 3) beats = [...FALLBACK_BEATS];
  if (beats.length > 7) beats = beats.slice(0, 7);
  if (!looksLikeGoodbye(beats[beats.length - 1])) {
    if (beats.length >= 7) beats[beats.length - 1] = "Wrap up warmly and say goodbye";
    else beats.push("Wrap up warmly and say goodbye");
  }
  return beats;
}

const OPENING_SYSTEM =
  `You are a friendly English conversation partner for a Russian-speaking learner (A2–B2). ` +
  `Design a short guided ROLE-PLAY MISSION on the topic, then start it.\n` +
  `1) Pick a concrete ROLE that fits the topic and stay in it the whole conversation ` +
  `(cafe→barista, job interview→interviewer). Add 2–3 small personal facts about your character ` +
  `you can naturally share later (role_facts).\n` +
  `2) Define a concrete end GOAL = the natural, satisfying endpoint of THIS scenario ` +
  `(e.g. cafe → "the customer orders a drink and a snack, hears the price, and says goodbye"). ` +
  `Also give goal_ru = a short Russian translation of the goal for the learner UI.\n` +
  `3) Write an ordered checklist of 3–7 must-cover BEATS (small sub-goals) that rise toward the goal; ` +
  `the LAST beat MUST be a warm wrap-up / goodbye.\n` +
  `4) Choose target_turns = an integer 7–15 sized to the goal (roughly beats.length..beats.length+4; ` +
  `richer scenario → more).\n` +
  `5) Give the FIRST spoken line (question): greet/react in character with a touch of self-intro, ` +
  `advancing beat 1 (speakable, ≤20 words), plus a suggested learner answer.\n` +
  `Reply STRICT JSON: {"role":string,"role_facts":[string],"goal":string,"goal_ru":string,` +
  `"beats":[string],"target_turns":number,"question":string,"suggestion":{"en":string,"ru":string}}. ` +
  `No text outside JSON.`;

export async function generateOpening(topic: string): Promise<DialoguePlan> {
  const errors = await recentErrorReasons();
  const { parsed } = await chatJson<unknown>({
    model: CHAT_MODEL,
    system: OPENING_SYSTEM + pastErrorsBlock(errors),
    user: `Topic: "${topic}". Design the mission and start it with the opening line.`,
    temperature: 0.7,
    maxTokens: 600,
    timeoutMs: 30_000,
  });
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const beats = normalizeBeats(o.beats);
  let target = Number.isFinite(Number(o.target_turns)) ? Math.round(Number(o.target_turns)) : 10;
  target = clampN(target, MIN_TURNS, MAX_TURNS);
  target = clampN(target, beats.length, beats.length + 4); // связь с числом бет в обе стороны
  const role = typeof o.role === "string" && o.role.trim() ? o.role.trim() : `a friendly partner for "${topic}"`;
  const facts = Array.isArray(o.role_facts) ? o.role_facts.map((f) => String(f).trim()).filter(Boolean).slice(0, 3) : [];
  const roleDesc = facts.length ? `${role}. Facts: ${facts.join("; ")}` : role;
  const goal =
    typeof o.goal === "string" && o.goal.trim() ? o.goal.trim() : `bring the conversation about "${topic}" to a natural, satisfying close`;
  const goalRu =
    typeof o.goal_ru === "string" && o.goal_ru.trim() ? o.goal_ru.trim() : "довести разговор до естественного завершения";
  const question =
    typeof o.question === "string" && o.question.trim() ? o.question.trim() : `Let's talk about ${topic}. What do you think about it?`;
  return { roleDesc, goal, goalRu, beats, targetTurns: target, question, suggestion: normalizeSuggestion(o.suggestion) };
}

export interface EvalResult {
  verdict: Verdict;
  errorReason: string | null;
  corrected: string | null;
  rephrase: string | null;
  nextQuestion: string | null;
  nextSuggestion: Suggestion | null;
  advanceBeats: number; // сколько бет закрыл ответ (0–2)
  share: string; // самораскрытие AI / прощальная реплика
  shouldEnd: boolean; // модель считает, что пора завершать
}

export interface Mission {
  goal: string;
  roleDesc: string;
  beats: string[];
  beatsDone: number;
  turnsLeft: number;
  phaseFlag: string; // DEVELOP | TOWARD_GOAL | WRAP_UP
  mustFinish: boolean;
}

const BASE_EVAL_SYSTEM =
  `You are an encouraging English speaking partner + coach in a LIVE voice conversation with a ` +
  `Russian-speaking learner (A2–B2). You are role-playing a consistent character for the topic — ` +
  `keep the conversation COHERENT, on-topic and in-character. The learner's answer comes from ` +
  `speech-to-text and may contain minor transcription noise — do NOT penalize plausible mishearings.\n` +
  `First decide the verdict:\n` +
  `- "clarify": the learner did NOT answer but asked to repeat/rephrase, said they don't understand, ` +
  `or asked what something means (in English OR Russian — e.g. "I don't understand", "can you repeat", ` +
  `"what does X mean", "что значит", "я не понял", "повтори"). This is NORMAL, NOT an error.\n` +
  `- "ok": communicates the meaning; small slips fine.\n` +
  `- "minor": understandable but with a noticeable slip (still continue).\n` +
  `- "gross": ONLY a serious GRAMMAR/vocabulary error that breaks the English. Do NOT use gross for ` +
  `content or relevance — if the English is fine, NEVER mark gross, even if the answer doesn't directly ` +
  `address the question. A real partner just rolls with tangents and keeps chatting.\n` +
  `- "skip": empty, nonsensical, or clearly not an attempt.\n` +
  `Be lenient and supportive — prefer continuing the conversation; only "gross" for broken English.\n` +
  `If clarify: set "rephrase" = the SAME current question reworded more simply/slowly in English ` +
  `(optionally a tiny hint). Do NOT advance the topic, do NOT mark an error.\n` +
  `If ok/minor: produce "next_question" — a natural SHORT follow-up (speakable, ~max 20 words) that ` +
  `DIRECTLY reacts to and builds on what the learner just said (reference a detail they mentioned), ` +
  `continuing the same scenario like a real person. Also a suggested answer for it.\n` +
  `For ok/minor/gross ALWAYS include NON-EMPTY "corrected": the learner's answer rewritten in correct, ` +
  `natural English keeping their meaning (if already correct, return it unchanged). For clarify/skip set corrected="".\n` +
  `If gross: "error_reason" is REQUIRED and NON-EMPTY — in RUSSIAN, 1–2 specific sentences naming what exactly ` +
  `is wrong and why (not generic).\n` +
  `Reply STRICT JSON: {"verdict":"ok|minor|gross|skip|clarify","corrected":string,"error_reason":string|null,` +
  `"rephrase":string|null,"next_question":string|null,"next_suggestion":{"en":string,"ru":string}|null,` +
  `"advance_beats":0,"share":string,"should_end":boolean}. No text outside JSON.`;

// Блок «миссии»: цель + чеклист + самораскрытие AI + движение к цели + финал.
const MISSION_RULES =
  `\n—— MISSION ——\n` +
  `You are running a guided role-play with a fixed GOAL and an ordered beat checklist. ` +
  `Behave like a REAL person, NOT an interrogator.\n` +
  `Rules for next_question (ok/minor only): it MUST have TWO parts — (a) a SHORT in-character reaction ` +
  `that ALSO shares something about YOU (an opinion, a small fact/feeling from your character) — this is ` +
  `NOT a question; then (b) ONE short question that advances the NEAREST OPEN BEAT toward the GOAL. ` +
  `Never produce a bare question. Keep total speakable, ≤25 words / ≤2 sentences.\n` +
  `Tangents: if PHASE is DEVELOP you MAY follow a tangent the learner opened for ONE exchange, then gently ` +
  `come back to the nearest open beat next turn. If PHASE is TOWARD_GOAL or WRAP_UP: acknowledge what they ` +
  `said in one clause, then steer firmly back toward the goal.\n` +
  `If PHASE is WRAP_UP or MUST_FINISH=true: do NOT ask a new progressing question — put a warm in-character ` +
  `goodbye that resolves the goal in "share", set next_question=null, set should_end=true.\n` +
  `Report: advance_beats = how many checklist beats the learner's answer just satisfied (0, 1, or 2 — usually ` +
  `0 or 1; be conservative). share = your in-character reaction/self-disclosure (also embedded into ` +
  `next_question; on wrap = the goodbye line). should_end = true only when the goal is genuinely reached ` +
  `or you are wrapping up.`;

// --- Оценка ответа + продолжение ---
export async function evaluateAnswer(args: {
  topic: string;
  aiQuestion: string;
  transcript: string;
  history: string;
  mission?: Mission;
}): Promise<EvalResult> {
  const errors = await recentErrorReasons();
  const m = args.mission;
  const system = BASE_EVAL_SYSTEM + (m ? MISSION_RULES : "") + pastErrorsBlock(errors);
  let user = `Topic: "${args.topic}".\n` + (args.history ? `Conversation so far:\n${args.history}\n\n` : "");
  if (m) {
    const nearestIdx = clampN(m.beatsDone, 0, Math.max(0, m.beats.length - 1));
    const checklist = m.beats.map((b, i) => `${i + 1}. [${i < m.beatsDone ? "DONE" : "TODO"}] ${b}`).join("\n");
    user +=
      `GOAL: ${m.goal}\n` +
      `YOUR ROLE (stay consistent; use these to share about yourself): ${m.roleDesc}\n` +
      `CHECKLIST (in order):\n${checklist}\n` +
      `NEAREST OPEN BEAT: #${nearestIdx + 1} — ${m.beats[nearestIdx]}\n` +
      `TURNS LEFT: ${m.turnsLeft}. PHASE: ${m.phaseFlag}.${m.mustFinish ? " MUST_FINISH=true." : ""}\n\n`;
  }
  user +=
    `AI's current question: "${args.aiQuestion}"\n` +
    `Learner's spoken answer (STT): "${args.transcript}"\n\n` +
    `Evaluate and reply JSON.`;
  const { parsed } = await chatJson<unknown>({
    model: CHAT_MODEL,
    system,
    user,
    temperature: 0.6, // чуть живее для разговорного next_question/share
    maxTokens: 420,
    timeoutMs: 30_000,
  });
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const verdict = normalizeVerdict(o.verdict);
  return {
    verdict,
    errorReason: typeof o.error_reason === "string" ? o.error_reason.trim() || null : null,
    corrected: typeof o.corrected === "string" ? o.corrected.trim() || null : null,
    rephrase: typeof o.rephrase === "string" ? o.rephrase.trim() || null : null,
    nextQuestion: typeof o.next_question === "string" ? o.next_question.trim() || null : null,
    nextSuggestion: o.next_suggestion ? normalizeSuggestion(o.next_suggestion) : null,
    advanceBeats: clampN(Math.round(Number(o.advance_beats)) || 0, 0, 2),
    share: typeof o.share === "string" ? o.share.trim() : "",
    shouldEnd: Boolean(o.should_end),
  };
}

function normalizeVerdict(v: unknown): Verdict {
  return v === "ok" || v === "minor" || v === "gross" || v === "skip" || v === "clarify" ? v : "minor";
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

// Стартовое состояние сессии: генерим план миссии + первую реплику, сохраняем.
export async function startSession(topic: string): Promise<{
  session: SessionRow;
  aiText: string;
  aiAudio: string | null;
  suggestion: Suggestion;
  goalRu: string;
  beatsTotal: number;
  beatsDone: number;
}> {
  const session = await createSession(topic);
  const plan = await generateOpening(topic);
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE live_dialogue_sessions
          SET goal = ?, goal_ru = ?, role_desc = ?, beats_json = ?, target_turns = ?, beats_done = 0,
              current_idx = 0, current_question = ?, current_suggestion = ?, turn_count = 1, updated_at = ?
          WHERE id = ?`,
    args: [
      plan.goal,
      plan.goalRu,
      plan.roleDesc,
      JSON.stringify(plan.beats),
      plan.targetTurns,
      plan.question,
      JSON.stringify(plan.suggestion),
      now,
      session.id,
    ],
  });
  const aiAudio = await synthSpeech(plan.question);
  return {
    session,
    aiText: plan.question,
    aiAudio,
    suggestion: plan.suggestion,
    goalRu: plan.goalRu,
    beatsTotal: plan.beats.length,
    beatsDone: 0,
  };
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
  // финал миссии (диалог завершён этим ходом):
  finished?: boolean;
  finalText?: string;
  finalAudio?: string | null;
  // прогресс миссии (для индикатора «N из M»):
  beatsDone?: number;
  beatsTotal?: number;
}

// Обрабатывает ответ пользователя: оценка + продвижение миссии / коррекция /
// повтор / завершение. Один LLM-вызов на ход; завершение решает сервер.
export async function processAnswer(
  session: SessionRow,
  transcript: string,
): Promise<AnswerOutcome> {
  const aiQuestion = session.current_question ?? "";
  const cleaned = transcript.trim();

  const beats = parseBeats(session.beats_json);
  const missionActive = beats.length > 0 && !!session.goal;
  const beatsTotal = beats.length;
  // Потолок длины: ≥ числа бет, в коридоре 7–15. Старые сессии — target_turns||10.
  const cap = missionActive
    ? clampN(Math.max(session.target_turns || MIN_TURNS, beats.length), MIN_TURNS, MAX_TURNS)
    : session.target_turns || 10;

  // Пустой/слишком короткий ответ — просим повторить, без штрафа.
  if (cleaned.length < 2) {
    await logTurn({ sessionId: session.id, idx: session.current_idx, aiText: aiQuestion, transcript: cleaned, verdict: "skip" });
    return { verdict: "skip", transcript: cleaned, repeatText: aiQuestion, beatsDone: session.beats_done, beatsTotal };
  }

  const turns = await getTurns(session.id);
  const history = buildHistory(turns);

  // Фазовый каркас (чистая арифметика до LLM).
  const turnsLeft = Math.max(0, cap - session.turn_count);
  const phaseFlag = turnsLeft <= 2 ? "WRAP_UP" : turnsLeft <= Math.ceil(cap * 0.35) ? "TOWARD_GOAL" : "DEVELOP";
  const mustFinish = missionActive && session.turn_count >= cap;
  const clarifyStreak = turns.filter((t) => t.idx === session.current_idx && t.verdict === "clarify").length;

  const evalRes = await evaluateAnswer({
    topic: session.topic,
    aiQuestion,
    transcript: cleaned,
    history,
    mission: missionActive
      ? { goal: session.goal as string, roleDesc: session.role_desc || "", beats, beatsDone: session.beats_done, turnsLeft, phaseFlag, mustFinish }
      : undefined,
  });

  // Санитизация правки: иногда модель возвращает обрывок (напр. "I") — отбрасываем.
  let corrected = evalRes.corrected;
  if (corrected) {
    const cw = corrected.split(/\s+/).filter(Boolean).length;
    const tw = cleaned.split(/\s+/).filter(Boolean).length;
    if (tw >= 3 && cw < Math.max(2, Math.floor(tw * 0.5))) corrected = null;
  }
  const correctedDiffers = !!corrected && corrected.toLowerCase().trim() !== cleaned.toLowerCase().trim();

  await logTurn({
    sessionId: session.id,
    idx: session.current_idx,
    aiText: aiQuestion,
    transcript: cleaned,
    verdict: evalRes.verdict,
    errorReason: evalRes.errorReason,
    correction: correctedDiffers ? corrected : null,
  });

  if (evalRes.verdict === "skip") {
    return { verdict: "skip", transcript: cleaned, repeatText: aiQuestion, beatsDone: session.beats_done, beatsTotal };
  }

  // «Не понял / повтори» — переспрашиваем тот же вопрос проще, без продвижения.
  if (evalRes.verdict === "clarify") {
    // Гард: серия переспросов (>3) — мягко сворачиваем к прощанию, не зависаем.
    if (missionActive && clarifyStreak >= 3) {
      const finalText = "No worries — let's wrap up here for today. You did really well. Talk soon!";
      const [finalAudio] = await Promise.all([
        synthSpeech(finalText),
        finalizeSession({ sessionId: session.id, beatsDone: session.beats_done, turnCount: session.turn_count, endedReason: "cap", bumpOk: false }),
      ]);
      return { verdict: "clarify", transcript: cleaned, finished: true, finalText, finalAudio, beatsDone: session.beats_done, beatsTotal };
    }
    const rephrase = evalRes.rephrase || aiQuestion;
    const [aiAudio] = await Promise.all([synthSpeech(rephrase), updateCurrentQuestionText(session.id, rephrase)]);
    return {
      verdict: "clarify",
      transcript: cleaned,
      aiText: rephrase,
      aiAudio,
      suggestion: parseSuggestionStr(session.current_suggestion),
      beatsDone: session.beats_done,
      beatsTotal,
    };
  }

  if (evalRes.verdict === "gross") {
    const reason = evalRes.errorReason || "Ответ содержит ошибку. Попробуй ещё раз.";
    const phrase = corrected || "";
    const speak = phrase ? `${phrase}. Try again.` : `Let's try that again.`;
    const [correctionAudio] = await Promise.all([synthSpeech(speak), bumpCounts(session.id, "error_count")]);
    return { verdict: "gross", transcript: cleaned, errorReason: reason, corrected: phrase, correctionAudio, beatsDone: session.beats_done, beatsTotal };
  }

  // ok / minor → продвигаем миссию (монотонный префиксный счётчик бет).
  const beatsDone = missionActive ? clampN(session.beats_done + evalRes.advanceBeats, 0, beats.length) : session.beats_done;
  const newTurnCount = session.turn_count + 1;

  // Детерминированное завершение на сервере (одно булево).
  const lowerOk = newTurnCount >= Math.floor(0.6 * cap); // гард от преждевременного конца
  let end = false;
  let endedReason = "";
  if (missionActive) {
    if (beatsDone >= beats.length) { end = true; endedReason = "beats"; }
    else if (newTurnCount > cap || mustFinish) { end = true; endedReason = "cap"; }
    else if (evalRes.shouldEnd && lowerOk) { end = true; endedReason = "goal"; }
  } else if (newTurnCount > cap) {
    end = true;
    endedReason = "cap";
  }

  if (end) {
    // Завершение по цели/бетам → миссия выполнена (индикатор N/N). По потолку
    // ходов (cap) — оставляем фактический прогресс (честно «не доведено»).
    const finalBeats = endedReason === "cap" ? beatsDone : beats.length;
    const finalText = pickFinal(evalRes.share, evalRes.nextQuestion);
    const [finalAudio] = await Promise.all([
      synthSpeech(finalText),
      finalizeSession({ sessionId: session.id, beatsDone: finalBeats, turnCount: newTurnCount, endedReason, bumpOk: true }),
    ]);
    return {
      verdict: evalRes.verdict,
      transcript: cleaned,
      corrected: correctedDiffers ? corrected : null,
      finished: true,
      finalText,
      finalAudio,
      beatsDone: finalBeats,
      beatsTotal,
    };
  }

  // Обычное продолжение — next_question уже содержит самораскрытие + двигает бету.
  const nextQuestion = evalRes.nextQuestion || "Nice. Can you tell me a bit more?";
  const nextSuggestion = evalRes.nextSuggestion || { en: "", ru: "" };
  const [aiAudio] = await Promise.all([
    synthSpeech(nextQuestion),
    advanceTurn({ sessionId: session.id, nextIdx: session.current_idx + 1, question: nextQuestion, suggestion: nextSuggestion, beatsDone, turnCount: newTurnCount }),
  ]);
  return {
    verdict: evalRes.verdict,
    transcript: cleaned,
    corrected: correctedDiffers ? corrected : null,
    aiText: nextQuestion,
    aiAudio,
    suggestion: nextSuggestion,
    beatsDone,
    beatsTotal,
  };
}
