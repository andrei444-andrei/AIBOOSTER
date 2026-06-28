"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Textarea } from "@/components/ui";
import History from "./History";
import styles from "./live.module.css";

interface Suggestion {
  en: string;
  ru: string;
}
type Verdict = "ok" | "minor" | "gross" | "skip";
type Mode = "setup" | "active" | "review" | "loading";

interface Msg {
  role: "ai" | "user";
  text: string;
  corrected?: string | null;
  verdict?: Verdict;
  errorReason?: string | null;
}

export default function LiveDialogueApp({ resumeId }: { resumeId?: string }) {
  const [mode, setMode] = useState<Mode>(resumeId ? "loading" : "setup");
  const [topic, setTopic] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState("");
  const [aiText, setAiText] = useState("");
  const [aiAudio, setAiAudio] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [correction, setCorrection] = useState<{ reason: string; phrase: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [summary, setSummary] = useState<{ ok: number; err: number; turns: number } | null>(null);

  // sessionId держим ещё и в ref. Запись (push-to-talk) стартует из
  // мемоизированного startRecording, чей onstop вызывает sendAnswer. Его deps
  // не включают sessionId, а переход setup→active не меняет busy/recording —
  // поэтому колбэк захватывал sessionId="" из первого рендера, и ПЕРВЫЙ ответ
  // уходил на /api/live-dialogue//answer → 405 (роут [id] без POST) → пустое
  // тело → "Unexpected end of JSON input". Ref всегда актуален и от этого не
  // зависит. Синхронизируем и эффектом, и явно в start()/resume().
  const sessionIdRef = useRef("");
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // --- Web Audio (надёжно на iOS) ---
  const ctxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const getCtx = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctxRef.current = new AC();
    }
    return ctxRef.current;
  }, []);
  const unlockAudio = useCallback(() => {
    const c = getCtx();
    if (c && c.state === "suspended") c.resume().catch(() => {});
  }, [getCtx]);
  const stopPlayback = useCallback(() => {
    try { srcRef.current?.stop(); } catch { /* ignore */ }
    srcRef.current = null;
  }, []);
  const playDataUri = useCallback(async (uri: string | null) => {
    if (!uri) return;
    const c = getCtx();
    if (!c) return;
    try {
      if (c.state === "suspended") await c.resume();
      const ab = await (await fetch(uri)).arrayBuffer();
      const buf = await c.decodeAudioData(ab);
      stopPlayback();
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start();
      srcRef.current = src;
    } catch { /* проигрывание не критично */ }
  }, [getCtx, stopPlayback]);
  const beepError = useCallback(() => {
    const c = getCtx();
    if (!c) return;
    const now = c.currentTime;
    [[0, 330], [0.16, 233]].forEach(([t, freq]) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now + t);
      g.gain.exponentialRampToValueAtTime(0.25, now + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.14);
      o.connect(g);
      g.connect(c.destination);
      o.start(now + t);
      o.stop(now + t + 0.15);
    });
  }, [getCtx]);

  // Озвучка произвольной фразы через сервер (Помощь, резюм, повтор без аудио).
  const speakAndPlay = useCallback(async (text: string) => {
    if (!text) return;
    try {
      const r = await fetch("/api/live-dialogue/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const d = await r.json();
      if (d.audio) await playDataUri(d.audio);
    } catch { /* ignore */ }
  }, [playDataUri]);

  // --- Запись (push-to-talk) ---
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const stopRecording = useCallback(() => {
    const r = recRef.current;
    if (r && r.state !== "inactive") {
      try { r.stop(); } catch { /* ignore */ }
    }
    setRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (busy || recording) return;
    unlockAudio();
    stopPlayback();
    setError(null);
    try {
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      if (typeof MediaRecorder === "undefined") {
        setError("Запись не поддерживается этим браузером.");
        return;
      }
      const rec = new MediaRecorder(streamRef.current);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const type = rec.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size < 1200) {
          setStatus("Слишком коротко — удерживай кнопку дольше.");
          return;
        }
        void sendAnswer(blob);
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      setStatus("Запись… говори");
    } catch {
      setError("Нет доступа к микрофону. Разреши доступ в настройках браузера.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, recording, unlockAudio, stopPlayback]);

  useEffect(() => {
    if (!recording) return;
    const up = () => stopRecording();
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [recording, stopRecording]);

  // Резюм существующей сессии.
  useEffect(() => {
    if (!resumeId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/live-dialogue/${resumeId}`, { cache: "no-store" });
        const d = await readJsonSafe(r);
        if (cancelled) return;
        if (!r.ok || !d.session) {
          setError(d.error || "не удалось загрузить сессию");
          setMode("review");
          return;
        }
        setSessionId(d.session.id);
        sessionIdRef.current = d.session.id;
        const msgs = buildMessagesFromTurns(d.turns || []);
        const cur = d.session.current_question as string | null;
        if (cur && (msgs.length === 0 || !(msgs[msgs.length - 1].role === "ai" && msgs[msgs.length - 1].text === cur))) {
          msgs.push({ role: "ai", text: cur });
        }
        setMessages(msgs);
        setSummary({ ok: d.session.ok_count ?? 0, err: d.session.error_count ?? 0, turns: d.session.turn_count ?? 0 });
        if (d.session.status === "active" && cur) {
          setAiText(cur);
          setSuggestion(d.session.current_suggestion ?? null);
          setMode("active");
        } else {
          setMode("review");
        }
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setMode("review"); }
      }
    })();
    return () => { cancelled = true; };
  }, [resumeId]);

  async function start() {
    if (!topic.trim()) { setError("укажи тему разговора"); return; }
    unlockAudio();
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/live-dialogue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: topic.trim() }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok || !data.session_id) {
        setError(data.error || `ошибка ${res.status}`);
        setStarting(false);
        return;
      }
      setSessionId(data.session_id);
      sessionIdRef.current = data.session_id;
      setAiText(data.ai_text);
      setAiAudio(data.ai_audio);
      setSuggestion(data.suggestion ?? null);
      setShowHint(false);
      setCorrection(null);
      setMessages([{ role: "ai", text: data.ai_text }]);
      setSummary(null);
      setMode("active");
      setStatus("");
      void playDataUri(data.ai_audio);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  async function sendAnswer(blob: Blob) {
    const sid = sessionIdRef.current;
    if (!sid) { setStatus(""); setError("Сессия ещё не готова — нажми «Ответить» и повтори."); return; }
    setBusy(true);
    setStatus("Проверяю ответ…");
    setCorrection(null);
    try {
      const fd = new FormData();
      fd.append("audio", blob, `answer.${extFor(blob.type)}`);
      const res = await fetch(`/api/live-dialogue/${sid}/answer`, { method: "POST", body: fd });
      const data = await readJsonSafe(res);
      if (!res.ok) {
        setStatus("");
        setError(data.error || `ошибка ${res.status}`);
        return;
      }
      if (data.verdict === "skip") {
        setStatus("Не расслышал — нажми «Ответить» и повтори.");
        return;
      }
      // лог: ответ пользователя (+ правка)
      setMessages((m) => [
        ...m,
        { role: "user", text: data.transcript || "", corrected: data.corrected ?? null, verdict: data.verdict, errorReason: data.error_reason ?? null },
      ]);
      if (data.verdict === "gross") {
        beepError();
        setCorrection({ reason: data.error_reason || "Есть ошибка.", phrase: data.corrected || "" });
        setStatus("");
        if (data.correction_audio) setTimeout(() => void playDataUri(data.correction_audio), 480);
        return;
      }
      // ok / minor → следующая реплика
      setAiText(data.ai_text || "");
      setAiAudio(data.ai_audio ?? null);
      setSuggestion(data.suggestion ?? null);
      setShowHint(false);
      setStatus("");
      setMessages((m) => [...m, { role: "ai", text: data.ai_text || "" }]);
      void playDataUri(data.ai_audio);
    } catch (err) {
      setStatus("");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleHint() {
    const next = !showHint;
    setShowHint(next);
    if (next && suggestion?.en) { unlockAudio(); void speakAndPlay(suggestion.en); }
  }

  function replay() {
    unlockAudio();
    if (aiAudio) void playDataUri(aiAudio);
    else if (aiText) void speakAndPlay(aiText);
  }

  async function finish() {
    stopPlayback();
    try {
      const res = await fetch(`/api/live-dialogue/${sessionIdRef.current}/finish`, { method: "POST" });
      const data = await res.json();
      const s = data.summary || {};
      setSummary({ ok: s.ok_count ?? 0, err: s.error_count ?? 0, turns: s.turn_count ?? 0 });
    } catch { /* ignore */ }
    setMode("review");
  }

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  // ---------- РЕНДЕР ----------
  if (mode === "loading") {
    return <Card padded style={{ marginTop: 20 }}><span style={{ color: "var(--text-secondary)" }}>Загружаем диалог…</span></Card>;
  }

  if (mode === "setup") {
    return (
      <div>
        <Card as="form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); void start(); }} padded>
          <Textarea
            label="О чём поговорить?"
            placeholder="Например: собеседование на работу; разговор в кафе; обсуждение путешествия…"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={2}
            autoFocus
            required
            errorText={error ?? undefined}
          />
          <Button type="submit" disabled={!topic.trim() || starting} loading={starting} size="lg" style={{ width: "100%", marginTop: 14 }}>
            {starting ? "Запускаю…" : "Начать разговор"}
          </Button>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.5 }}>
            AI задаёт вопросы голосом, ты отвечаешь, удерживая кнопку. «Помощь» подскажет и озвучит фразу.
          </p>
        </Card>
        <h2 style={{ fontSize: 18, margin: "28px 0 10px" }}>История диалогов</h2>
        <History />
      </div>
    );
  }

  if (mode === "review") {
    return (
      <div>
        <Card padded style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Диалог</div>
          {summary && (
            <div style={{ color: "var(--text-secondary)", fontSize: 14 }}>
              реплик {summary.turns} · верных <span style={{ color: "var(--success)" }}>{summary.ok}</span> · ошибок{" "}
              <span style={{ color: "var(--danger)" }}>{summary.err}</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <a href="/tools/english/live-dialogue" style={{ textDecoration: "none" }}><Button variant="primary">Новый диалог</Button></a>
          </div>
        </Card>
        <Transcript messages={messages} />
      </div>
    );
  }

  // active
  return (
    <div>
      <div className={styles.aiCard}>
        <div className={styles.aiLabel}>AI спрашивает</div>
        <div className={styles.aiText}>{aiText || "…"}</div>
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button size="sm" variant="ghost" onClick={replay}>▶ Повторить</Button>
          <Button size="sm" variant="ghost" onClick={finish}>Завершить</Button>
        </div>
      </div>

      {showHint && suggestion && (
        <div className={styles.hint}>
          <div className={styles.hintEn}>{suggestion.en || "—"}</div>
          {suggestion.ru && <div className={styles.hintRu}>{suggestion.ru}</div>}
        </div>
      )}

      {correction && (
        <div className={styles.correction}>
          <div className={styles.correctionReason}>
            <span style={{ color: "var(--danger)", fontWeight: 600 }}>Ошибка. </span>{correction.reason}
          </div>
          {correction.phrase && <div className={styles.correctionPhrase}>Правильно: «{correction.phrase}»</div>}
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>Нажми «Ответить» и повтори правильно.</div>
        </div>
      )}

      <div className={styles.status}>{status}</div>
      {error && <div style={{ color: "var(--danger)", fontSize: 13, textAlign: "center", marginBottom: 8 }}>{error}</div>}

      <div className={styles.controls}>
        <div className={styles.controlRow}>
          <button
            type="button"
            className={`${styles.talkBtn} ${recording ? styles.talkBtnRec : ""} ${busy ? styles.talkBtnDisabled : ""}`}
            onPointerDown={(e) => { e.preventDefault(); void startRecording(); }}
          >
            {recording ? "Отпусти, чтобы отправить" : busy ? "Обрабатываю…" : "Удерживай — отвечай"}
          </button>
          <button type="button" className={styles.helpBtn} onClick={toggleHint}>
            {showHint ? "Скрыть" : "Помощь"}
          </button>
        </div>
      </div>

      {messages.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className={styles.aiLabel} style={{ marginBottom: 8 }}>Диалог</div>
          <Transcript messages={messages} />
        </div>
      )}
    </div>
  );
}

function Transcript({ messages }: { messages: Msg[] }) {
  // Свежие реплики сверху (как просили) — рендерим в обратном порядке.
  const ordered = [...messages].reverse();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {ordered.map((m, i) =>
        m.role === "ai" ? (
          <div key={i} style={{ alignSelf: "flex-start", maxWidth: "92%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "8px 12px" }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>AI</span>
            <div style={{ fontSize: "var(--text-base)", color: "var(--text)" }}>{m.text}</div>
          </div>
        ) : (
          <div key={i} style={{ alignSelf: "flex-end", maxWidth: "92%", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "8px 12px" }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Ты</span>
            <div style={{ fontSize: "var(--text-base)", color: m.verdict === "gross" ? "var(--text-secondary)" : "var(--text)" }}>{m.text || "—"}</div>
            {m.corrected && (
              <div style={{ fontSize: "var(--text-sm)", marginTop: 4 }}>
                <span style={{ color: "var(--text-muted)" }}>✎ </span>
                {renderDiff(m.text || "", m.corrected)}
              </div>
            )}
            {m.verdict === "gross" && m.errorReason && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{m.errorReason}</div>
            )}
          </div>
        ),
      )}
    </div>
  );
}

// Подсветка исправлений: токены исправленной версии, которых нет в исходной
// (по позиции через LCS), показываем красным.
function renderDiff(orig: string, corrected: string) {
  const A = orig.split(/\s+/).filter(Boolean);
  const B = corrected.split(/\s+/).filter(Boolean);
  const norm = (w: string) => w.toLowerCase().replace(/[.,!?;:"'']/g, "");
  const Al = A.map(norm);
  const Bl = B.map(norm);
  const n = Al.length, m = Bl.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = Al[i] === Bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Array<{ t: string; err: boolean }> = [];
  let i = 0, j = 0;
  while (j < m) {
    if (i < n && Al[i] === Bl[j]) { out.push({ t: B[j], err: false }); i++; j++; }
    else if (i < n && dp[i + 1][j] >= dp[i][j + 1]) { i++; }
    else { out.push({ t: B[j], err: true }); j++; }
  }
  return (
    <span>
      {out.map((tok, k) => (
        <span key={k} style={tok.err ? { color: "var(--danger)", fontWeight: 600 } : { color: "var(--text)" }}>
          {tok.t}{k < out.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}

function buildMessagesFromTurns(turns: Array<{ idx: number; ai_text: string; user_transcript: string | null; verdict: Verdict | null; error_reason: string | null; correction: string | null }>): Msg[] {
  const msgs: Msg[] = [];
  let lastAiIdx = -1;
  for (const t of turns) {
    if (t.idx !== lastAiIdx) {
      msgs.push({ role: "ai", text: t.ai_text });
      lastAiIdx = t.idx;
    }
    msgs.push({
      role: "user",
      text: t.user_transcript || "",
      corrected: t.correction ?? null,
      verdict: t.verdict ?? undefined,
      errorReason: t.error_reason ?? null,
    });
  }
  return msgs;
}

// Безопасный разбор ответа: пустое/не-JSON тело (таймаут, холодный старт) не
// роняет UI криптовым «Unexpected end of JSON input», а даёт понятную ошибку.
async function readJsonSafe(res: Response) {
  const raw = await res.text();
  if (!raw) throw new Error("Сервер не ответил. Попробуй ещё раз.");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Сбой ответа сервера. Попробуй ещё раз.");
  }
}

function extFor(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  return "webm";
}
