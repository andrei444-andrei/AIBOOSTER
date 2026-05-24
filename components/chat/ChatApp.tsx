"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import {
  MODEL_OPTIONS,
  MODE_OPTIONS,
  CATEGORY_META,
  DEFAULT_MODE,
  getModelOption,
  type ChatMode,
  type ModelOption,
} from "@/lib/chat-client";
import styles from "./ChatApp.module.css";

// ─── Типы ────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  title: string;
  model: string;
  mode: ChatMode;
  model_override: string | null;
  updated_at: string;
}

type Role = "user" | "assistant" | "system";

interface Attachment {
  id?: string;
  filename: string;
  mime_type: string;
  size: number;
  kind: "text" | "image";
  content_text?: string | null;
  content_base64?: string | null;
}

interface RouteMeta {
  category: string;
  complexity: string;
  mode: ChatMode;
  source: "override" | "auto" | "fallback";
  reason: string;
  reasoning_effort?: string;
  uncertain?: boolean;
  routing_latency_ms?: number;
}

interface Message {
  id: string;
  role: Role;
  content: string;
  model?: string | null;
  created_at: string;
  attachments?: Attachment[];
  streaming?: boolean;
  error?: string | null;
  tokens_prompt?: number | null;
  tokens_completion?: number | null;
  duration_ms?: number | null;
  route_meta?: RouteMeta | null;
  /** Дополнительная информация о текущем стриме (для индикатора над контентом). */
  liveRoute?: RouteMeta | null;
}

// ─── Утилиты UID ─────────────────────────────────────────────────────

const UID_KEY = "chat_uid";

function getOrCreateUid(): string {
  if (typeof window === "undefined") return "";
  let v = window.localStorage.getItem(UID_KEY);
  if (!v) {
    v = (crypto.randomUUID?.() ?? `uid_${Date.now()}_${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_\-]/g, "");
    window.localStorage.setItem(UID_KEY, v);
  }
  return v;
}

// ─── Файлы ───────────────────────────────────────────────────────────

const TEXT_MIME_PREFIXES = ["text/", "application/json", "application/xml", "application/x-yaml"];
const TEXT_EXT = [
  "txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml",
  "js", "ts", "jsx", "tsx", "py", "rb", "go", "rs", "java", "kt", "swift",
  "c", "h", "cpp", "cc", "hpp", "cs", "sql", "sh", "bash", "zsh",
  "html", "css", "scss", "sass", "less", "vue", "svelte", "log", "env",
  "ini", "toml", "conf", "gitignore",
];
const IMAGE_MIME = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

function classifyFile(file: File): "text" | "image" | null {
  if (IMAGE_MIME.includes(file.type)) return "image";
  if (TEXT_MIME_PREFIXES.some((p) => file.type.startsWith(p))) return "text";
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext && TEXT_EXT.includes(ext)) return "text";
  return null;
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(String(r.result ?? ""));
    r.readAsText(file, "utf-8");
  });
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const s = String(r.result ?? "");
      const idx = s.indexOf(",");
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    r.readAsDataURL(file);
  });
}

// ─── Форматирование ──────────────────────────────────────────────────

const AUTO_VALUE = "__auto__";

function formatDuration(ms?: number | null): string | null {
  if (!ms || ms <= 0) return null;
  if (ms < 1000) return `${ms} мс`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} с`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}м ${s}с`;
}

function categoryLabel(c?: string | null): string | null {
  if (!c) return null;
  return CATEGORY_META[c as keyof typeof CATEGORY_META]?.label ?? c;
}

// ─── Компонент ───────────────────────────────────────────────────────

export function ChatApp({ initialUid }: { initialUid?: string }) {
  const [uid, setUid] = useState<string>(initialUid ?? "");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  // Состояние режима и override-модели. Авто = модель не зафиксирована, роутер выбирает сам.
  // Эти значения хранятся per-chat в БД. Здесь — локальное зеркало для активной сессии.
  const [mode, setMode] = useState<ChatMode>(DEFAULT_MODE);
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // инициализация uid и списка сессий
  useEffect(() => {
    const v = getOrCreateUid();
    setUid(v);
  }, []);

  const fetchSessions = useCallback(async (currentUid: string) => {
    if (!currentUid) return;
    try {
      const r = await fetch("/api/chat/sessions", { headers: { "x-chat-uid": currentUid } });
      const data = await r.json();
      if (r.ok) setSessions(data.sessions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (uid) fetchSessions(uid);
  }, [uid, fetchSessions]);

  const loadMessages = useCallback(
    async (sessionId: string) => {
      if (!uid) return;
      setLoadingMessages(true);
      try {
        const r = await fetch(`/api/chat/sessions/${sessionId}`, { headers: { "x-chat-uid": uid } });
        const data = await r.json();
        if (!r.ok) {
          setError(data?.error?.message ?? "Не удалось загрузить чат");
          setMessages([]);
          return;
        }
        setMessages(data.messages ?? []);
        if (data.session) {
          setMode((data.session.mode as ChatMode) ?? DEFAULT_MODE);
          setModelOverride(data.session.model_override ?? null);
        }
        // При открытии чата — один раз прокрутить в самый низ, чтобы видеть последние сообщения.
        requestAnimationFrame(() => {
          const el = scrollerRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingMessages(false);
      }
    },
    [uid],
  );

  useEffect(() => {
    if (activeId) loadMessages(activeId);
    else setMessages([]);
  }, [activeId, loadMessages]);

  // ID последнего отправленного user-сообщения — на следующем рендере прокручиваем
  // его к ~18% от верха scrollerа, чтобы оставить ~80% места ниже под ответ.
  // Во время стрима НЕ скроллим — пользователь читает в своём темпе.
  const [pendingScrollUserMsg, setPendingScrollUserMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingScrollUserMsg) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const el = scroller.querySelector<HTMLElement>(`[data-msg-id="${pendingScrollUserMsg}"]`);
    if (!el) return;
    // целевая позиция верха сообщения в координатах вьюпорта scrollerа
    const targetTop = scroller.clientHeight * 0.18;
    const currentTop = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTo({ top: scroller.scrollTop + currentTop - targetTop, behavior: "smooth" });
    setPendingScrollUserMsg(null);
  }, [pendingScrollUserMsg]);

  // автовысота textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  }, [input]);

  // ─── Действия ──────────────────────────────────────────────────────

  const newChat = useCallback(async () => {
    if (!uid) return;
    setError(null);
    try {
      const r = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-chat-uid": uid },
        // Новый чат всегда стартует в Auto + текущем режиме.
        // Принудительно сбрасываем override, чтобы «следующий чат» открылся в Auto.
        body: JSON.stringify({ mode, modelOverride: null }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data?.error?.message ?? "Не удалось создать чат");
        return;
      }
      setSessions((s) => [data.session, ...s]);
      setActiveId(data.session.id);
      setMessages([]);
      setInput("");
      setPendingAttachments([]);
      setModelOverride(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [uid, mode]);

  const deleteChat = useCallback(
    async (id: string) => {
      if (!uid) return;
      if (!confirm("Удалить чат полностью?")) return;
      try {
        const r = await fetch(`/api/chat/sessions/${id}`, {
          method: "DELETE",
          headers: { "x-chat-uid": uid },
        });
        if (r.ok) {
          setSessions((s) => s.filter((x) => x.id !== id));
          if (activeId === id) {
            setActiveId(null);
            setMessages([]);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [uid, activeId],
  );

  // ─── Переключатели Pro/Обычный и Auto/Модель ──────────────────────

  const changeMode = useCallback(
    async (next: ChatMode) => {
      if (next === mode) return;
      setMode(next);
      if (activeId && uid) {
        try {
          await fetch(`/api/chat/sessions/${activeId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "x-chat-uid": uid },
            body: JSON.stringify({ mode: next }),
          });
        } catch {
          /* тихо — UI уже переключился, при следующей отправке улетит в body */
        }
      }
    },
    [mode, activeId, uid],
  );

  const changeModel = useCallback(
    async (next: string) => {
      // AUTO_VALUE → сбрасываем override и возвращаемся к роутеру.
      const newOverride = next === AUTO_VALUE ? null : next;
      setModelOverride(newOverride);
      if (activeId && uid) {
        try {
          await fetch(`/api/chat/sessions/${activeId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "x-chat-uid": uid },
            body: JSON.stringify({ modelOverride: newOverride }),
          });
        } catch {
          /* тихо */
        }
      }
    },
    [activeId, uid],
  );

  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next: Attachment[] = [];
    for (const f of Array.from(files)) {
      const kind = classifyFile(f);
      if (!kind) {
        setError(`Файл "${f.name}" имеет неподдерживаемый тип (${f.type || "unknown"}).`);
        continue;
      }
      try {
        if (kind === "text") {
          if (f.size > 220_000) {
            setError(`Текстовый файл "${f.name}" слишком большой (макс 220КБ).`);
            continue;
          }
          const text = await readAsText(f);
          next.push({
            filename: f.name,
            mime_type: f.type || "text/plain",
            size: f.size,
            kind: "text",
            content_text: text,
          });
        } else {
          if (f.size > 6_000_000) {
            setError(`Изображение "${f.name}" слишком большое (макс 6МБ).`);
            continue;
          }
          const b64 = await readAsBase64(f);
          next.push({
            filename: f.name,
            mime_type: f.type,
            size: f.size,
            kind: "image",
            content_base64: b64,
          });
        }
      } catch (err) {
        setError(`Не удалось прочитать "${f.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (next.length) setPendingAttachments((p) => [...p, ...next]);
  }, []);

  const removeAttachment = useCallback((idx: number) => {
    setPendingAttachments((p) => p.filter((_, i) => i !== idx));
  }, []);

  const send = useCallback(async () => {
    if (sending) return;
    const text = input.trim();
    if (!text && pendingAttachments.length === 0) return;
    if (!uid) return;
    setError(null);

    // если активной сессии нет — создадим
    let sid = activeId;
    if (!sid) {
      try {
        const r = await fetch("/api/chat/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-chat-uid": uid },
          body: JSON.stringify({ mode, modelOverride }),
        });
        const data = await r.json();
        if (!r.ok) {
          setError(data?.error?.message ?? "Не удалось создать чат");
          return;
        }
        sid = data.session.id as string;
        setSessions((s) => [data.session, ...s]);
        setActiveId(sid);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    const userAttachments = pendingAttachments.slice();
    const userMsgLocal: Message = {
      id: `local-user-${Date.now()}`,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
      attachments: userAttachments,
    };
    const assistantLocal: Message = {
      id: `local-assistant-${Date.now()}`,
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
      streaming: true,
      model: modelOverride,
      liveRoute: null,
    };
    setMessages((m) => [...m, userMsgLocal, assistantLocal]);
    setInput("");
    setPendingAttachments([]);
    setSending(true);
    // прокрутить только что отправленное сообщение в верхнюю четверть экрана
    setPendingScrollUserMsg(userMsgLocal.id);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const r = await fetch(`/api/chat/sessions/${sid}/messages`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-chat-uid": uid },
        body: JSON.stringify({
          content: text,
          mode,
          modelOverride,
          attachments: userAttachments,
        }),
      });
      if (!r.ok || !r.body) {
        const data = await r.json().catch(() => null);
        const msg = data?.error?.message ?? `HTTP ${r.status}`;
        setMessages((arr) =>
          arr.map((m) => (m.id === assistantLocal.id ? { ...m, streaming: false, error: msg } : m)),
        );
        setError(msg);
        return;
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const flushEvents = (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let event = "message";
          const dataLines: string[] = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          }
          if (!dataLines.length) continue;
          let payload: unknown;
          try {
            payload = JSON.parse(dataLines.join("\n"));
          } catch {
            continue;
          }
          handleSseEvent(event, payload, assistantLocal.id);
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        flushEvents(decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") {
        setMessages((arr) =>
          arr.map((m) =>
            m.id === assistantLocal.id ? { ...m, streaming: false, error: "Запрос отменён" } : m,
          ),
        );
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setMessages((arr) =>
          arr.map((m) => (m.id === assistantLocal.id ? { ...m, streaming: false, error: msg } : m)),
        );
        setError(msg);
      }
    } finally {
      setSending(false);
      abortRef.current = null;
      if (sid) {
        fetchSessions(uid);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, uid, input, mode, modelOverride, pendingAttachments, sending, fetchSessions]);

  const handleSseEvent = useCallback((event: string, payload: unknown, assistantLocalId: string) => {
    if (event === "user_message") {
      const p = payload as { id: string };
      setMessages((arr) =>
        arr.map((m) =>
          m.role === "user" && m.id.startsWith("local-user-") && !arr.some((x) => x.id === p.id)
            ? { ...m, id: p.id }
            : m,
        ),
      );
    } else if (event === "route") {
      const p = payload as RouteMeta & { model: string };
      setMessages((arr) =>
        arr.map((m) =>
          m.id === assistantLocalId
            ? { ...m, model: p.model, liveRoute: p }
            : m,
        ),
      );
    } else if (event === "delta") {
      const p = payload as { text: string };
      setMessages((arr) =>
        arr.map((m) => (m.id === assistantLocalId ? { ...m, content: m.content + p.text } : m)),
      );
    } else if (event === "done") {
      const p = payload as {
        id: string | null;
        created_at: string;
        model?: string;
        duration_ms?: number;
        route?: RouteMeta;
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
      setMessages((arr) =>
        arr.map((m) =>
          m.id === assistantLocalId
            ? {
                ...m,
                streaming: false,
                id: p.id ?? m.id,
                created_at: p.created_at,
                model: p.model ?? m.model,
                duration_ms: p.duration_ms ?? null,
                route_meta: p.route ?? m.route_meta ?? null,
                tokens_prompt: p.usage?.prompt_tokens ?? null,
                tokens_completion: p.usage?.completion_tokens ?? null,
                liveRoute: null,
              }
            : m,
        ),
      );
    } else if (event === "error") {
      const p = payload as { message: string; error_id?: string };
      setMessages((arr) =>
        arr.map((m) =>
          m.id === assistantLocalId
            ? {
                ...m,
                streaming: false,
                error: `${p.message}${p.error_id ? ` (error_id: ${p.error_id})` : ""}`,
              }
            : m,
        ),
      );
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const currentSession = useMemo(() => sessions.find((s) => s.id === activeId) ?? null, [sessions, activeId]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        void send();
      }
    },
    [send],
  );

  // Селектор моделей: для нормального режима показываем только доступные в normal,
  // плюс всегда — текущий override (даже если он deep). В Pro доступны все.
  const modelOptionsForMode = useMemo<ModelOption[]>(() => {
    if (mode === "pro") return MODEL_OPTIONS;
    const base = MODEL_OPTIONS.filter((m) => m.availableInModes.includes("normal"));
    if (modelOverride && !base.some((m) => m.id === modelOverride)) {
      const extra = MODEL_OPTIONS.find((m) => m.id === modelOverride);
      if (extra) return [...base, extra];
    }
    return base;
  }, [mode, modelOverride]);

  return (
    <div className={styles.app}>
      {/* Sidebar */}
      <aside className={`${styles.sidebar} ${sidebarOpen ? "" : styles.sidebarClosed}`}>
        <div className={styles.sidebarHeader}>
          <button className={styles.newBtn} onClick={newChat}>
            + Новый чат
          </button>
        </div>
        <div className={styles.sessions}>
          {sessions.length === 0 ? (
            <div className={styles.empty}>Нет чатов</div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className={`${styles.sessionItem} ${activeId === s.id ? styles.active : ""}`}
                onClick={() => setActiveId(s.id)}
              >
                <div className={styles.sessionTitle} title={s.title}>
                  {s.title || "Без названия"}
                </div>
                <button
                  className={styles.delBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteChat(s.id);
                  }}
                  aria-label="Удалить"
                  title="Удалить"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main */}
      <main className={styles.main}>
        <header className={styles.header}>
          <button
            className={styles.toggleSidebar}
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Свернуть сайдбар"
            title="Свернуть сайдбар"
          >
            ☰
          </button>
          <div className={styles.headerTitle}>
            {currentSession?.title || "AI Chat"}
          </div>

          <select
            className={styles.modelSelect}
            value={modelOverride ?? AUTO_VALUE}
            onChange={(e) => changeModel(e.target.value)}
            disabled={sending}
            title={modelOverride ? "Принудительно выбрана модель (стикает в этом чате)" : "Авто-роутер выбирает модель под задачу"}
          >
            <option value={AUTO_VALUE}>
              {mode === "pro" ? "⚡ Auto · Pro" : "⚡ Auto"}
            </option>
            {modelOptionsForMode.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </header>

        <div ref={scrollerRef} className={styles.scroller}>
          <div className={styles.messages}>
            {messages.length === 0 && !loadingMessages && (
              <div className={styles.welcome}>
                <h2 style={{ marginBottom: 8 }}>AI Chat</h2>
                <p style={{ color: "var(--text-secondary)" }}>
                  Задайте вопрос, прикрепите файлы или картинки. Роутер сам выберет модель —
                  или выберите вручную: тогда она стикнет в этом чате.
                </p>
              </div>
            )}
            {messages.map((m) => (
              <MessageBlock key={m.id} message={m} />
            ))}
          </div>
        </div>

        {error && (
          <div className={styles.errorBanner}>
            {error}
            <button onClick={() => setError(null)} className={styles.errorClose}>×</button>
          </div>
        )}

        <Composer
          input={input}
          setInput={setInput}
          attachments={pendingAttachments}
          onAddFiles={addFiles}
          onRemoveAttachment={removeAttachment}
          onSend={send}
          onStop={stop}
          onKeyDown={onKeyDown}
          textareaRef={textareaRef}
          sending={sending}
          mode={mode}
          onChangeMode={changeMode}
        />
      </main>
    </div>
  );
}

// ─── Подкомпоненты ───────────────────────────────────────────────────

function MessageBlock({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const route = message.route_meta;
  const live = message.liveRoute;
  const showLiveHint = message.streaming && live && !message.content;
  const showTypeHint = message.streaming && !live && !message.content;

  return (
    <div
      className={`${styles.msgRow} ${isUser ? styles.msgUser : styles.msgAssistant}`}
      data-msg-id={message.id}
    >
      <div className={styles.avatar}>{isUser ? "Ты" : "AI"}</div>
      <div className={styles.msgBody}>
        {message.attachments && message.attachments.length > 0 && (
          <div className={styles.attachments}>
            {message.attachments.map((a, i) => (
              <AttachmentChip key={a.id ?? i} attachment={a} />
            ))}
          </div>
        )}

        {/* Подсказка стрима: «Маршрутизирую…» → «Claude Opus · ресёрч · pro» */}
        {!isUser && showLiveHint && live && (
          <div className={styles.streamHint}>
            <span className={styles.streamHintPulse} />
            <span>{routeLabel(live, message.model)}</span>
          </div>
        )}
        {!isUser && showTypeHint && (
          <div className={styles.streamHint}>
            <span className={styles.streamHintPulse} />
            <span>Маршрутизирую запрос…</span>
          </div>
        )}

        {isUser ? (
          <div className={styles.userText}>{message.content}</div>
        ) : message.content ? (
          <Markdown source={message.content} />
        ) : message.streaming ? (
          <div className={styles.typing}>
            <span /><span /><span />
          </div>
        ) : null}
        {message.streaming && message.content && (
          <span className={styles.streamCursor} aria-hidden>▍</span>
        )}
        {message.error && (
          <div className={styles.msgError}>Ошибка: {message.error}</div>
        )}

        {/* Бейдж под завершённым ответом */}
        {!isUser && !message.streaming && !message.error && message.content && (
          <MessageMeta message={message} />
        )}
      </div>
    </div>
  );
}

function routeLabel(route: RouteMeta, model: string | null | undefined): string {
  const modelLabel = model ? getModelOption(model).label : "Маршрутизирую";
  const cat = categoryLabel(route.category);
  const parts = [modelLabel];
  if (cat) parts.push(cat);
  if (route.mode === "pro") parts.push("pro");
  return parts.join(" · ");
}

function MessageMeta({ message }: { message: Message }) {
  const modelOption = message.model ? getModelOption(message.model) : null;
  const route = message.route_meta;
  const duration = formatDuration(message.duration_ms);
  const cat = categoryLabel(route?.category);
  const tokensIn = message.tokens_prompt;
  const tokensOut = message.tokens_completion;
  const isPro = route?.mode === "pro";

  return (
    <div className={styles.msgMeta}>
      {modelOption && (
        <span
          className={`${styles.metaChip} ${route?.source === "auto" ? styles.metaChipAuto : ""}`}
          title={modelOption.description}
        >
          <span className={`${styles.metaDot} ${isPro ? styles.metaDotPro : ""}`} />
          {modelOption.label}
        </span>
      )}
      {route?.source === "auto" && <span className={styles.metaChip}>⚡ auto</span>}
      {route?.source === "fallback" && <span className={styles.metaChip}>эвристика</span>}
      {route?.source === "override" && <span className={styles.metaChip}>вручную</span>}
      {cat && <span className={styles.metaChip}>{cat}</span>}
      {isPro && <span className={styles.metaChip}>pro</span>}
      {duration && <span className={styles.metaChip}>⏱ {duration}</span>}
      {tokensIn != null && tokensOut != null && (
        <span className={styles.metaChip} title="prompt / completion tokens">
          {tokensIn}↑ {tokensOut}↓
        </span>
      )}
    </div>
  );
}

function AttachmentChip({ attachment }: { attachment: Attachment }) {
  if (attachment.kind === "image" && attachment.content_base64) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`data:${attachment.mime_type};base64,${attachment.content_base64}`}
        alt={attachment.filename}
        className={styles.attachImage}
        title={attachment.filename}
      />
    );
  }
  return (
    <div className={styles.attachFile} title={`${attachment.filename} · ${attachment.size} байт`}>
      <span className={styles.attachIcon}>📄</span>
      <span className={styles.attachName}>{attachment.filename}</span>
    </div>
  );
}

function Composer({
  input,
  setInput,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  onSend,
  onStop,
  onKeyDown,
  textareaRef,
  sending,
  mode,
  onChangeMode,
}: {
  input: string;
  setInput: (s: string) => void;
  attachments: Attachment[];
  onAddFiles: (files: FileList | null) => void;
  onRemoveAttachment: (idx: number) => void;
  onSend: () => void;
  onStop: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  sending: boolean;
  mode: ChatMode;
  onChangeMode: (m: ChatMode) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`${styles.composer} ${dragOver ? styles.dragOver : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onAddFiles(e.dataTransfer.files);
      }}
    >
      {attachments.length > 0 && (
        <div className={styles.composerAttachments}>
          {attachments.map((a, i) => (
            <div key={i} className={styles.composerChip}>
              {a.kind === "image" && a.content_base64 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`data:${a.mime_type};base64,${a.content_base64}`}
                  alt={a.filename}
                  className={styles.composerChipImg}
                />
              ) : (
                <span className={styles.composerChipIcon}>📄</span>
              )}
              <span className={styles.composerChipName}>{a.filename}</span>
              <button
                type="button"
                className={styles.composerChipX}
                onClick={() => onRemoveAttachment(i)}
                aria-label="Убрать вложение"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className={styles.composerInputRow}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          rows={1}
          placeholder="Спросите что-нибудь… (Enter — отправить, Shift+Enter — новая строка)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className={styles.composerTools}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          title="Прикрепить файл"
          aria-label="Прикрепить файл"
        >
          📎
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            onAddFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className={styles.modeGroup} role="tablist" aria-label="Режим">
          {MODE_OPTIONS.map((opt) => {
            const isPro = opt.id === "pro";
            const isActive = mode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`${styles.modeBtn} ${isActive ? styles.modeBtnActive : ""}`}
                onClick={() => onChangeMode(opt.id)}
                disabled={sending}
                title={
                  isPro
                    ? "Pro: думающие модели (Claude Opus, GPT-5 с extended reasoning, Gemini 2.5 Pro). Дольше, точнее."
                    : `${opt.description} ${opt.hint}`
                }
              >
                {isPro ? "🧠 " : ""}
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className={styles.toolsSpacer} />
        {sending ? (
          <button type="button" className={styles.sendBtn} onClick={onStop}>
            ■ Стоп
          </button>
        ) : (
          <button
            type="button"
            className={styles.sendBtn}
            onClick={onSend}
            disabled={!input.trim() && attachments.length === 0}
          >
            Отправить →
          </button>
        )}
      </div>
    </div>
  );
}
