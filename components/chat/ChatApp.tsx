"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import {
  MODEL_OPTIONS,
  CATEGORY_META,
  TASK_CATEGORIES,
  getModelOption,
  isTaskCategory,
  isKnownModel,
  type TaskCategory,
  type ModelOption,
} from "@/lib/chat-client";
import styles from "./ChatApp.module.css";

// ─── Типы ────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  title: string;
  model: string;
  model_override: string | null;
  category_override: TaskCategory | null;
  updated_at: string;
}

type Role = "user" | "assistant" | "system";

interface Attachment {
  id?: string;
  filename: string;
  mime_type: string;
  size: number;
  kind: "text" | "image" | "image_url";
  content_text?: string | null;
  content_base64?: string | null;
}

interface RouteMeta {
  category: string;
  complexity: string;
  source: "override-model" | "override-category" | "auto" | "fallback";
  reason: string;
  reasoning_effort?: string | null;
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
  liveRoute?: RouteMeta | null;
}

// ─── Selection: что пользователь выбрал в селекторе ──────────────────

type Selection =
  | { type: "auto" }
  | { type: "category"; value: TaskCategory }
  | { type: "model"; value: string };

const AUTO_VALUE = "auto";
function encodeSelection(s: Selection): string {
  if (s.type === "auto") return AUTO_VALUE;
  if (s.type === "category") return `cat:${s.value}`;
  return `model:${s.value}`;
}
function decodeSelection(v: string): Selection {
  if (v === AUTO_VALUE) return { type: "auto" };
  if (v.startsWith("cat:")) {
    const cat = v.slice(4);
    if (isTaskCategory(cat)) return { type: "category", value: cat };
  }
  if (v.startsWith("model:")) {
    const m = v.slice(6);
    if (isKnownModel(m)) return { type: "model", value: m };
  }
  return { type: "auto" };
}
function sessionToSelection(s: SessionRow | null): Selection {
  if (!s) return { type: "auto" };
  if (s.model_override) return { type: "model", value: s.model_override };
  if (s.category_override) return { type: "category", value: s.category_override };
  return { type: "auto" };
}

// ─── Утилиты UID ─────────────────────────────────────────────────────

// ─── UID владельца ──────────────────────────────────────────────────
//
// Продукт — для одного пользователя (см. CLAUDE.md). Все чаты собираются
// под фиксированным OWNER_UID, чтобы история была одна на все браузеры,
// устройства и сессии. Раньше каждый клиент получал случайный UID в
// localStorage — что в итоге дробило историю при смене браузера/инкогнито.

const OWNER_UID = "owner-andrei-2026";

function getOrCreateUid(): string {
  return OWNER_UID;
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
  return CATEGORY_META[c as TaskCategory]?.label ?? c;
}

// ─── Компонент ───────────────────────────────────────────────────────

export function ChatApp({ initialUid }: { initialUid?: string }) {
  const [uid, setUid] = useState<string>(initialUid ?? "");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  // Выбор пользователя в селекторе. Хранится per-chat в БД, тут локальное зеркало.
  const [selection, setSelection] = useState<Selection>({ type: "auto" });
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // ID сессии, для которой нужно пропустить ближайший loadMessages —
  // используется когда send() сам создал сессию и уже заполнил state
  // локальными user+assistant сообщениями; иначе useEffect[activeId] их сотрёт.
  const skipLoadRef = useRef<string | null>(null);

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
      // Если сессию только что создал send() и сам обновил state,
      // повторно тянуть пустой список из БД нельзя — затрёт локальные сообщения.
      if (skipLoadRef.current === sessionId) {
        skipLoadRef.current = null;
        return;
      }
      setLoadingMessages(true);
      try {
        const r = await fetch(`/api/chat/sessions/${sessionId}`, { headers: { "x-chat-uid": uid } });
        const data = await r.json();
        if (!r.ok) {
          setError(data?.error?.message ?? "Не удалось загрузить чат");
          setMessages([]);
          return;
        }
        const loaded = (data.messages ?? []) as Message[];
        setMessages(loaded);
        if (data.session) {
          setSelection(sessionToSelection(data.session as SessionRow));
        }
        // С историей — в самый низ; пустой чат — наверх, чтобы welcome
        // не уехал в padding-bottom.
        requestAnimationFrame(() => {
          const el = scrollerRef.current;
          if (!el) return;
          el.scrollTop = loaded.length > 0 ? el.scrollHeight : 0;
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

  const [pendingScrollUserMsg, setPendingScrollUserMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingScrollUserMsg) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const el = scroller.querySelector<HTMLElement>(`[data-msg-id="${pendingScrollUserMsg}"]`);
    if (!el) return;
    const targetTop = scroller.clientHeight * 0.18;
    const currentTop = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTo({ top: scroller.scrollTop + currentTop - targetTop, behavior: "smooth" });
    setPendingScrollUserMsg(null);
  }, [pendingScrollUserMsg]);

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
        body: JSON.stringify({}), // новый чат всегда стартует в Auto
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data?.error?.message ?? "Не удалось создать чат");
        return;
      }
      setSessions((s) => [data.session, ...s]);
      // useEffect[activeId] вызовет loadMessages, который для нового
      // пустого чата сам уведёт scroll наверх.
      skipLoadRef.current = null;
      setActiveId(data.session.id);
      setMessages([]);
      setInput("");
      setPendingAttachments([]);
      setSelection({ type: "auto" });
      requestAnimationFrame(() => {
        const el = scrollerRef.current;
        if (el) el.scrollTop = 0;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [uid]);

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

  const changeSelection = useCallback(
    async (next: Selection) => {
      setSelection(next);
      if (activeId && uid) {
        const body: Record<string, unknown> =
          next.type === "auto"
            ? { reset: true }
            : next.type === "category"
              ? { categoryOverride: next.value }
              : { modelOverride: next.value };
        try {
          await fetch(`/api/chat/sessions/${activeId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "x-chat-uid": uid },
            body: JSON.stringify(body),
          });
        } catch {
          // тихо — UI уже переключился, на следующий send улетит в теле сообщения
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

    let sid = activeId;
    if (!sid) {
      try {
        const initBody: Record<string, unknown> =
          selection.type === "category"
            ? { categoryOverride: selection.value }
            : selection.type === "model"
              ? { modelOverride: selection.value }
              : {};
        const r = await fetch("/api/chat/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-chat-uid": uid },
          body: JSON.stringify(initBody),
        });
        const data = await r.json();
        if (!r.ok) {
          setError(data?.error?.message ?? "Не удалось создать чат");
          return;
        }
        sid = data.session.id as string;
        // Помечаем сессию как «только что создана здесь» — loadMessages, который
        // триггерится через useEffect[activeId], пропустит её и не сотрёт state.
        skipLoadRef.current = sid;
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
      model: selection.type === "model" ? selection.value : null,
      liveRoute: null,
    };
    setMessages((m) => [...m, userMsgLocal, assistantLocal]);
    setInput("");
    setPendingAttachments([]);
    setSending(true);
    setPendingScrollUserMsg(userMsgLocal.id);

    const controller = new AbortController();
    abortRef.current = controller;

    const overrideBody: Record<string, unknown> = {};
    if (selection.type === "model") overrideBody.modelOverride = selection.value;
    else if (selection.type === "category") overrideBody.categoryOverride = selection.value;
    else {
      overrideBody.modelOverride = null;
      overrideBody.categoryOverride = null;
    }

    try {
      const r = await fetch(`/api/chat/sessions/${sid}/messages`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-chat-uid": uid },
        body: JSON.stringify({
          content: text,
          ...overrideBody,
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
  }, [activeId, uid, input, selection, pendingAttachments, sending, fetchSessions]);

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
          m.id === assistantLocalId ? { ...m, model: p.model, liveRoute: p } : m,
        ),
      );
    } else if (event === "delta") {
      const p = payload as { text: string };
      setMessages((arr) =>
        arr.map((m) => (m.id === assistantLocalId ? { ...m, content: m.content + p.text } : m)),
      );
    } else if (event === "web_images") {
      // Картинки с веб-поиска (Perplexity Sonar): URLы, не base64.
      const p = payload as { images: Array<{ image_url: string; title?: string }> };
      if (!Array.isArray(p.images) || p.images.length === 0) return;
      setMessages((arr) =>
        arr.map((m) => {
          if (m.id !== assistantLocalId) return m;
          const existing = m.attachments ?? [];
          const haveUrls = new Set(
            existing.filter((a) => a.kind === "image_url").map((a) => a.content_text),
          );
          const fresh: Attachment[] = p.images
            .filter((img) => img.image_url && !haveUrls.has(img.image_url))
            .map((img) => ({
              filename: img.title ? img.title.slice(0, 100) : "web image",
              mime_type: "image/*",
              size: 0,
              kind: "image_url",
              content_text: img.image_url,
            }));
          if (fresh.length === 0) return m;
          return { ...m, attachments: [...existing, ...fresh] };
        }),
      );
    } else if (event === "citations") {
      // Источники — пока просто игнорируем на клиенте, в bigger PR будут чипами.
      return;
    } else if (event === "image") {
      const p = payload as { base64: string; mime: string };
      setMessages((arr) =>
        arr.map((m) =>
          m.id === assistantLocalId
            ? {
                ...m,
                attachments: [
                  ...(m.attachments ?? []),
                  {
                    filename: `image-${(m.attachments?.length ?? 0) + 1}.png`,
                    mime_type: p.mime,
                    size: Math.floor((p.base64.length * 3) / 4),
                    kind: "image",
                    content_base64: p.base64,
                  },
                ],
              }
            : m,
        ),
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

  return (
    <div className={styles.chatLayout}>
      <aside className={styles.chatSidebar}>
        <div className={styles.sessionsPanel}>
          <button className={styles.newBtn} onClick={newChat}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            <span>Новый чат</span>
          </button>
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
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.header}>
          <div className={styles.headerTitle}>
            {currentSession?.title || "AI Chat"}
          </div>
        </header>

        <div ref={scrollerRef} className={styles.scroller}>
          <div
            className={[
              styles.messages,
              messages.length === 0 ? styles.messagesEmpty : "",
              sending ? styles.messagesWaiting : "",
            ].filter(Boolean).join(" ")}
          >
            {messages.length === 0 && !loadingMessages && (
              <div className={styles.welcome}>
                <h2>С чего начнём?</h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-md)", maxWidth: 460, margin: "0 auto" }}>
                  Auto-роутер сам подберёт модель под задачу. Или выберите пресет —
                  Быстрый/Ресёрч/Код/Анализ/Стратегия — в селекторе ниже.
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
          selectionValue={encodeSelection(selection)}
          onChangeSelection={(v) => changeSelection(decodeSelection(v))}
        />
      </div>
    </div>
  );
}

// ─── Селектор моделей ────────────────────────────────────────────────

function ModelSelector({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  // Группируем модели по vendor для optgroup'ов внутри секции «Модели».
  const byVendor = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    for (const m of MODEL_OPTIONS) {
      const arr = map.get(m.vendor) ?? [];
      arr.push(m);
      map.set(m.vendor, arr);
    }
    return Array.from(map.entries());
  }, []);

  let title: string;
  if (value === AUTO_VALUE) title = "Auto: роутер сам выбирает модель под задачу";
  else if (value.startsWith("cat:")) {
    const cat = value.slice(4) as TaskCategory;
    title = `Пресет «${CATEGORY_META[cat]?.label ?? cat}» — модель из настроек /admin/chat`;
  } else if (value.startsWith("model:")) {
    title = `Принудительно выбрана модель: ${getModelOption(value.slice(6)).label}`;
  } else {
    title = "Выбор модели";
  }

  return (
    <select
      className={styles.modelSelect}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      title={title}
    >
      <option value={AUTO_VALUE}>⚡ Auto — роутер выбирает</option>
      <optgroup label="── Категории ──">
        {TASK_CATEGORIES.map((cat) => (
          <option key={cat} value={`cat:${cat}`}>
            {CATEGORY_META[cat].icon} {CATEGORY_META[cat].label}
          </option>
        ))}
      </optgroup>
      {byVendor.map(([vendor, models]) => (
        <optgroup key={vendor} label={`── ${vendor} ──`}>
          {models.map((m) => (
            <option key={m.id} value={`model:${m.id}`}>
              {m.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ─── Сообщение ───────────────────────────────────────────────────────

function MessageBlock({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className={styles.msgUser} data-msg-id={message.id}>
        {message.attachments && message.attachments.length > 0 && (
          <div className={styles.attachments}>
            {message.attachments.map((a, i) => (
              <AttachmentChip key={a.id ?? i} attachment={a} />
            ))}
          </div>
        )}
        {message.content && <div className={styles.userBubble}>{message.content}</div>}
      </div>
    );
  }

  // assistant
  const live = message.liveRoute;
  const hasAttachments = (message.attachments?.length ?? 0) > 0;
  const isImageCategory = message.route_meta?.category === "image" || live?.category === "image";
  // Пока стримим:
  // - текстовая категория: показываем "thinking" пока нет content
  // - image-категория: показываем "Рисую…" пока нет attachments
  const isThinking =
    message.streaming &&
    !message.content &&
    !hasAttachments;
  const hintText = isImageCategory
    ? `Рисую · ${message.model ? getModelOption(message.model).label : "image-модель"}`
    : live
      ? routeLabel(live, message.model)
      : "Маршрутизирую запрос";

  return (
    <div className={styles.msgAssistant} data-msg-id={message.id}>
      <div className={styles.assistantBody}>
        {isThinking ? (
          <div className={styles.thinking}>
            <span className={styles.thinkingDot} />
            <span className={styles.thinkingText}>{hintText}</span>
            <span className={styles.thinkingEllipsis} aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </div>
        ) : null}

        {hasAttachments && (
          <div className={isImageCategory ? styles.assistantImages : styles.assistantWebImages}>
            {message.attachments!.map((a, i) => (
              <AttachmentChip key={a.id ?? i} attachment={a} />
            ))}
          </div>
        )}

        {message.content && !isImageCategory && <Markdown source={message.content} />}
        {message.streaming && message.content && !isImageCategory && (
          <span className={styles.streamCursor} aria-hidden>▍</span>
        )}
        {message.error && (
          <div className={styles.msgError}>Ошибка: {message.error}</div>
        )}

        {!message.streaming && !message.error && (message.content || hasAttachments) && (
          <MessageMeta message={message} />
        )}
      </div>
    </div>
  );
}

function routeLabel(route: RouteMeta, model: string | null | undefined): string {
  const modelLabel = model ? getModelOption(model).label : "Маршрутизирую";
  const cat = categoryLabel(route.category);
  return cat ? `${modelLabel} · ${cat.toLowerCase()}` : modelLabel;
}

function MessageMeta({ message }: { message: Message }) {
  const modelOption = message.model ? getModelOption(message.model) : null;
  const route = message.route_meta;
  const duration = formatDuration(message.duration_ms);
  const cat = categoryLabel(route?.category);
  const tokensIn = message.tokens_prompt;
  const tokensOut = message.tokens_completion;
  const sourceLabel: Record<string, string> = {
    auto: "⚡ auto",
    fallback: "эвристика",
    "override-model": "вручную модель",
    "override-category": "вручную категория",
  };

  return (
    <div className={styles.msgMeta}>
      {modelOption && (
        <span
          className={`${styles.metaChip} ${route?.source === "auto" ? styles.metaChipAuto : ""}`}
          title={modelOption.description}
        >
          <span className={styles.metaDot} />
          {modelOption.label}
        </span>
      )}
      {route?.source && <span className={styles.metaChip}>{sourceLabel[route.source] ?? route.source}</span>}
      {cat && <span className={styles.metaChip}>{cat}</span>}
      {route?.reasoning_effort && (
        <span className={styles.metaChip}>think: {route.reasoning_effort}</span>
      )}
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
  if (attachment.kind === "image_url" && attachment.content_text) {
    // Картинка с веб-поиска: открывается в новой вкладке.
    return (
      <a
        href={attachment.content_text}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.webImageLink}
        title={attachment.filename || attachment.content_text}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={attachment.content_text}
          alt={attachment.filename || "web image"}
          className={styles.attachImage}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </a>
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
  selectionValue,
  onChangeSelection,
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
  selectionValue: string;
  onChangeSelection: (v: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  return (
    <div className={styles.composerOuter}>
      <div
        className={`${styles.composer} ${dragOver ? styles.dragOver : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          dragCounter.current += 1;
          if (e.dataTransfer.types?.includes("Files")) setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDragLeave={() => {
          dragCounter.current -= 1;
          if (dragCounter.current <= 0) {
            dragCounter.current = 0;
            setDragOver(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragCounter.current = 0;
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
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          rows={1}
          placeholder="Спросите что-нибудь… (Enter — отправить, Shift+Enter — новая строка)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className={styles.composerTools}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            title="Прикрепить файл"
            aria-label="Прикрепить файл"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
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

          <ModelSelector value={selectionValue} onChange={onChangeSelection} disabled={sending} />

          <div className={styles.toolsSpacer} />

          {sending ? (
            <button type="button" className={`${styles.sendBtn} ${styles.sendBtnStop}`} onClick={onStop}>
              <span className={styles.sendBtnIcon}>■</span>
              <span>Стоп</span>
            </button>
          ) : (
            <button
              type="button"
              className={styles.sendBtn}
              onClick={onSend}
              disabled={!input.trim() && attachments.length === 0}
            >
              <span>Отправить</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </button>
          )}
        </div>

        {dragOver && (
          <div className={styles.dropOverlay}>
            <div className={styles.dropOverlayInner}>
              <div className={styles.dropOverlayIcon}>↓</div>
              <div>Отпустите, чтобы прикрепить файл</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
