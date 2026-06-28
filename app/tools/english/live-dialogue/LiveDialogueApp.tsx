"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Textarea } from "@/components/ui";
import History from "./History";
import styles from "./live.module.css";

interface Suggestion {
  en: string;
  ru: string;
}
type Mode = "setup" | "active" | "done";

export default function LiveDialogueApp() {
  const [mode, setMode] = useState<Mode>("setup");
  const [topic, setTopic] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Состояние активной сессии
  const [sessionId, setSessionId] = useState("");
  const [aiText, setAiText] = useState("");
  const [aiAudio, setAiAudio] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [correction, setCorrection] = useState<{ reason: string; phrase: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [summary, setSummary] = useState<{ ok: number; err: number; turns: number } | null>(null);

  // --- Аудио через Web Audio (надёжно на iOS: контекст разблокируем жестом,
  // дальше можно проигрывать после async без потери gesture-контекста). ---
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
    try {
      srcRef.current?.stop();
    } catch {
      /* ignore */
    }
    srcRef.current = null;
  }, []);

  const playDataUri = useCallback(
    async (uri: string | null) => {
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
      } catch {
        /* проигрывание не критично */
      }
    },
    [getCtx, stopPlayback],
  );

  const beepError = useCallback(() => {
    const c = getCtx();
    if (!c) return;
    const now = c.currentTime;
    [
      [0, 330],
      [0.16, 233],
    ].forEach(([t, freq]) => {
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

  // --- Запись (push-to-talk) ---
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const stopRecording = useCallback(() => {
    const r = recRef.current;
    if (r && r.state !== "inactive") {
      try {
        r.stop();
      } catch {
        /* ignore */
      }
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
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
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

  // Отпускание кнопки где угодно — останавливаем запись.
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

  async function start() {
    if (!topic.trim()) {
      setError("укажи тему разговора");
      return;
    }
    unlockAudio();
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/live-dialogue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: topic.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.session_id) {
        setError(data.error || `ошибка ${res.status}`);
        setStarting(false);
        return;
      }
      setSessionId(data.session_id);
      setAiText(data.ai_text);
      setAiAudio(data.ai_audio);
      setSuggestion(data.suggestion ?? null);
      setShowHint(false);
      setTranscript(null);
      setCorrection(null);
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
    setBusy(true);
    setStatus("Проверяю ответ…");
    setCorrection(null);
    try {
      const fd = new FormData();
      fd.append("audio", blob, `answer.${extFor(blob.type)}`);
      const res = await fetch(`/api/live-dialogue/${sessionId}/answer`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setStatus("");
        setError(data.error || `ошибка ${res.status}`);
        return;
      }
      setTranscript(data.transcript || null);
      if (data.verdict === "skip") {
        setStatus("Не расслышал — нажми «Ответить» и повтори.");
        return;
      }
      if (data.verdict === "gross") {
        beepError();
        setCorrection({ reason: data.error_reason || "Есть ошибка.", phrase: data.correction || "" });
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
      void playDataUri(data.ai_audio);
    } catch (err) {
      setStatus("");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    stopPlayback();
    try {
      const res = await fetch(`/api/live-dialogue/${sessionId}/finish`, { method: "POST" });
      const data = await res.json();
      const s = data.summary || {};
      setSummary({ ok: s.ok_count ?? 0, err: s.error_count ?? 0, turns: s.turn_count ?? 0 });
    } catch {
      setSummary({ ok: 0, err: 0, turns: 0 });
    }
    setMode("done");
  }

  function reset() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setMode("setup");
    setTopic("");
    setSessionId("");
    setAiText("");
    setAiAudio(null);
    setSuggestion(null);
    setTranscript(null);
    setCorrection(null);
    setSummary(null);
    setStatus("");
    setError(null);
  }

  // Отпускаем микрофон при размонтировании.
  useEffect(() => {
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

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
            AI задаёт вопросы голосом, ты отвечаешь, удерживая кнопку. «Помощь» подскажет фразу.
            Нужен доступ к микрофону.
          </p>
        </Card>

        <h2 style={{ fontSize: 18, margin: "28px 0 10px" }}>История диалогов</h2>
        <History />
      </div>
    );
  }

  if (mode === "done" && summary) {
    return (
      <Card padded>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Диалог завершён</div>
        <div style={{ color: "var(--text-secondary)", marginBottom: 4 }}>
          Реплик: {summary.turns} · верных: <span style={{ color: "var(--success)" }}>{summary.ok}</span> ·
          ошибок: <span style={{ color: "var(--danger)" }}>{summary.err}</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
          Лог ошибок и ответов сохранён — он влияет на будущие диалоги.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="primary" onClick={reset}>Новый диалог</Button>
          <a href={`/tools/english/live-dialogue/s/${sessionId}`} style={{ textDecoration: "none" }}>
            <Button variant="secondary">Посмотреть лог</Button>
          </a>
        </div>
      </Card>
    );
  }

  // active
  return (
    <div>
      <div className={styles.aiCard}>
        <div className={styles.aiLabel}>AI спрашивает</div>
        <div className={styles.aiText}>{aiText || "…"}</div>
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button size="sm" variant="ghost" onClick={() => { unlockAudio(); void playDataUri(aiAudio); }} disabled={!aiAudio}>
            ▶ Повторить
          </Button>
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
            <span style={{ color: "var(--danger)", fontWeight: 600 }}>Ошибка. </span>
            {correction.reason}
          </div>
          {correction.phrase && (
            <div className={styles.correctionPhrase}>Правильно: «{correction.phrase}»</div>
          )}
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>
            Нажми «Ответить» и повтори правильно.
          </div>
        </div>
      )}

      {transcript && !correction && (
        <div className={styles.transcript}>Ты сказал: «{transcript}»</div>
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
          <button
            type="button"
            className={styles.helpBtn}
            onClick={() => setShowHint((v) => !v)}
          >
            {showHint ? "Скрыть" : "Помощь"}
          </button>
        </div>
      </div>
    </div>
  );
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
