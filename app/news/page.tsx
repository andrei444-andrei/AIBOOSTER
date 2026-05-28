"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Светящееся-серое оформление в стилистике /admin и app/page.tsx.
const wrap: React.CSSProperties = { maxWidth: 1100, margin: "0 auto", padding: "32px 24px" };
const card: React.CSSProperties = {
  background: "#12161c",
  border: "1px solid #232a33",
  borderRadius: 10,
  padding: 16,
  marginBottom: 16,
};
const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  background: active ? "#1f2933" : "transparent",
  border: "1px solid #232a33",
  borderRight: "none",
  color: active ? "#fff" : "#a0a8b0",
  cursor: "pointer",
  fontSize: 14,
});
const chip: React.CSSProperties = {
  display: "inline-block",
  fontSize: 12,
  padding: "2px 8px",
  borderRadius: 99,
  background: "#1a1e24",
  border: "1px solid #232a33",
  marginRight: 6,
  marginTop: 4,
  color: "#a0a8b0",
};
const chipBtn = (color: string): React.CSSProperties => ({
  fontSize: 12,
  padding: "4px 10px",
  borderRadius: 99,
  background: "transparent",
  border: `1px solid ${color}`,
  color,
  cursor: "pointer",
  marginRight: 6,
  marginTop: 6,
});
const codeBox: React.CSSProperties = {
  background: "#0b0d10",
  border: "1px solid #232a33",
  borderRadius: 6,
  padding: 10,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 400,
  overflow: "auto",
};

type Tab = "feed" | "skipped" | "debug";

interface NewsItem {
  id: string;
  source: { id: string; name: string; kind: string; url: string };
  url: string | null;
  title: string | null;
  body: string | null;
  published_at: string | null;
  summary: string | null;
  value_explanation: string | null;
  matched_topics: string[];
  relevance: number | null;
  verdict: "show" | "borderline" | "skip" | null;
  reasoning: string | null;
  model_used: string | null;
  validated_at: string | null;
  created_at: string;
  status: string;
  validation_input: string | null;
  validation_output_json: string | null;
  validation_error: string | null;
}

interface PromptData {
  profile: { worldview_context: string; topics: unknown[] };
  sample_prompt: { system: string; user: string };
  stats: Record<string, number>;
  model: string;
}

const LIKE_REASONS = ["точно по теме", "практично/применимо", "новый угол"];
const DISLIKE_REASONS = ["не моя тема", "поверхностно", "уже видел", "кликбейт"];

export default function NewsPage() {
  const [token, setToken] = useState<string>("");
  const [tab, setTab] = useState<Tab>("feed");
  const [items, setItems] = useState<NewsItem[]>([]);
  const [skipped, setSkipped] = useState<NewsItem[]>([]);
  const [decisions, setDecisions] = useState<NewsItem[]>([]);
  const [promptData, setPromptData] = useState<PromptData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const u = new URL(window.location.href);
    let t = u.searchParams.get("token") ?? "";
    if (!t) {
      try {
        t = window.sessionStorage.getItem("aibooster_token") ?? "";
      } catch {
        /* ignore */
      }
    } else {
      try {
        window.sessionStorage.setItem("aibooster_token", t);
      } catch {
        /* ignore */
      }
      // Чистим ?token=... из URL: не попадает в history, в Referer, в логи.
      u.searchParams.delete("token");
      window.history.replaceState({}, "", u.toString());
    }
    setToken(t);
  }, []);

  const authHeader = useMemo<Record<string, string>>(
    () => {
      const h: Record<string, string> = {};
      if (token) h.authorization = `Bearer ${token}`;
      return h;
    },
    [token],
  );

  const loadFeed = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/news/items?verdict=show&limit=100", { headers: authHeader });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setItems(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token, authHeader]);

  const loadSkipped = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/news/items/skipped?limit=100", { headers: authHeader });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setSkipped(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token, authHeader]);

  const loadDebug = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [pr, dr] = await Promise.all([
        fetch("/api/news/prompt", { headers: authHeader }),
        fetch("/api/news/decisions?limit=50", { headers: authHeader }),
      ]);
      const pd = await pr.json();
      const dd = await dr.json();
      if (!pr.ok) throw new Error(pd.error || `HTTP ${pr.status}`);
      if (!dr.ok) throw new Error(dd.error || `HTTP ${dr.status}`);
      setPromptData(pd);
      setDecisions(dd.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token, authHeader]);

  useEffect(() => {
    if (!token) return;
    if (tab === "feed") void loadFeed();
    else if (tab === "skipped") void loadSkipped();
    else void loadDebug();
  }, [token, tab, loadFeed, loadSkipped, loadDebug]);

  const sendFeedback = async (item_id: string, signal: "like" | "dislike", reason?: string) => {
    try {
      await fetch("/api/news/feedback", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader },
        body: JSON.stringify({ item_id, signal, reason_chip: reason ?? null }),
      });
    } catch (e) {
      // soft-fail для UI: фидбэк опционален
      console.error("feedback failed", e);
    }
  };

  const promote = async (item_id: string) => {
    // Оптимистично убираем из "Отсеяно" — пользователь видит результат сразу,
    // не ждёт re-fetch'а. Если бэк ответит ошибкой — откатываем.
    const prev = skipped;
    setSkipped(skipped.filter((x) => x.id !== item_id));
    try {
      const r = await fetch("/api/news/items/promote", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader },
        body: JSON.stringify({ item_id }),
      });
      if (!r.ok) {
        setSkipped(prev);
        const data = await r.json().catch(() => ({}));
        setError(`promote failed: ${data.error ?? r.status}`);
      }
    } catch (e) {
      setSkipped(prev);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!token) {
    return (
      <main style={wrap}>
        <h1>AIBOOSTER · /news</h1>
        <div style={card}>
          <p>Нужен ADMIN_TOKEN. Открой страницу с <code>?token=YOUR_TOKEN</code> в URL.</p>
        </div>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>AIBOOSTER · /news</h1>
        <nav style={{ fontSize: 13, opacity: 0.7 }}>
          <a href="/news/sources" style={{ color: "#79b8ff", marginLeft: 12 }}>источники</a>
          <a href="/news/profile" style={{ color: "#79b8ff", marginLeft: 12 }}>профиль</a>
          <a href={`/admin?token=${token}`} style={{ color: "#79b8ff", marginLeft: 12 }}>admin</a>
        </nav>
      </header>

      <div style={{ display: "flex", marginBottom: 16 }}>
        <button style={{ ...tabBtn(tab === "feed"), borderTopLeftRadius: 6, borderBottomLeftRadius: 6 }} onClick={() => setTab("feed")}>Лента</button>
        <button style={tabBtn(tab === "skipped")} onClick={() => setTab("skipped")}>Отсеяно</button>
        <button style={{ ...tabBtn(tab === "debug"), borderRight: "1px solid #232a33", borderTopRightRadius: 6, borderBottomRightRadius: 6 }} onClick={() => setTab("debug")}>Отладка</button>
      </div>

      {error && (
        <div style={{ ...card, borderColor: "#7a2b2b" }}>
          Ошибка: {error}
        </div>
      )}
      {loading && <div style={{ opacity: 0.6, marginBottom: 12 }}>Загрузка…</div>}

      {tab === "feed" && (
        <FeedList items={items} onFeedback={sendFeedback} />
      )}

      {tab === "skipped" && (
        <SkippedList items={skipped} onPromote={promote} />
      )}

      {tab === "debug" && (
        <DebugPanel prompt={promptData} decisions={decisions} />
      )}
    </main>
  );
}

function FeedList({ items, onFeedback }: { items: NewsItem[]; onFeedback: (id: string, s: "like" | "dislike", r?: string) => void }) {
  if (items.length === 0) {
    return (
      <div style={card}>
        <p style={{ marginTop: 0 }}>В ленте пусто.</p>
        <p style={{ opacity: 0.7 }}>
          Это нормально на чистой БД. Cron-tick запускается раз в 10 минут;
          можно дёрнуть вручную:
        </p>
        <pre style={codeBox}>{`curl -X POST $APP/api/news/cron/tick \\\n  -H "Authorization: Bearer $CRON_SECRET"`}</pre>
      </div>
    );
  }
  return (
    <>
      {items.map((it) => (
        <ItemCard key={it.id} item={it} onFeedback={onFeedback} />
      ))}
    </>
  );
}

function SkippedList({ items, onPromote }: { items: NewsItem[]; onPromote: (id: string) => void }) {
  if (items.length === 0) {
    return (
      <div style={card}>
        <p style={{ marginTop: 0 }}>Отсеянных нет.</p>
      </div>
    );
  }
  return (
    <>
      <p style={{ opacity: 0.6, fontSize: 13 }}>
        Это посты, которые валидатор пометил как skip. Если что-то реально полезное здесь —
        нажми «показать в ленте» (это сигнал для калибровки промта).
      </p>
      {items.map((it) => (
        <div key={it.id} style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontWeight: 600 }}>{it.title || "(без заголовка)"}</div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>{it.source.name} · {it.relevance ?? "—"}/100</div>
          </div>
          {it.summary && <div style={{ opacity: 0.8, fontSize: 14, marginTop: 6 }}>{it.summary}</div>}
          {it.reasoning && (
            <div style={{ fontSize: 13, opacity: 0.7, marginTop: 8, fontStyle: "italic" }}>
              Причина: {it.reasoning}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            {(it.matched_topics ?? []).map((t) => <span key={t} style={chip}>{t}</span>)}
          </div>
          <div style={{ marginTop: 8 }}>
            {it.url && <a href={it.url} target="_blank" rel="noreferrer" style={{ color: "#79b8ff", fontSize: 13 }}>читать источник →</a>}
            <button onClick={() => onPromote(it.id)} style={{ ...chipBtn("#3fb950"), marginLeft: 12 }}>
              показать в ленте
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

function ItemCard({ item, onFeedback }: { item: NewsItem; onFeedback: (id: string, s: "like" | "dislike", r?: string) => void }) {
  const [expandedFeedback, setExpandedFeedback] = useState<null | "like" | "dislike">(null);
  const [sent, setSent] = useState(false);
  const [inflight, setInflight] = useState(false);

  const handleQuick = (s: "like" | "dislike") => {
    // sent блокирует и финальное состояние, и повторные клики после первого.
    if (sent || inflight) return;
    setInflight(true);
    setExpandedFeedback(s);
    void onFeedback(item.id, s);
  };
  const handleReason = (r: string) => {
    if (!expandedFeedback || sent) return;
    void onFeedback(item.id, expandedFeedback, r);
    setSent(true);
  };

  return (
    <article style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 17, fontWeight: 600 }}>
          {item.title || "(без заголовка)"}
        </div>
        <div style={{ fontSize: 12, opacity: 0.55, marginLeft: 12, whiteSpace: "nowrap" }}>
          {item.source.name} · {item.relevance ?? "—"}/100
        </div>
      </div>
      {item.summary && (
        <div style={{ fontSize: 14, opacity: 0.85, marginTop: 8 }}>{item.summary}</div>
      )}
      {item.value_explanation && (
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 8, paddingLeft: 12, borderLeft: "2px solid #2b6cb0" }}>
          <b>Почему вам:</b> {item.value_explanation}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        {(item.matched_topics ?? []).map((t) => <span key={t} style={chip}>{t}</span>)}
      </div>
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", flexWrap: "wrap" }}>
        {item.url && (
          <a href={item.url} target="_blank" rel="noreferrer" style={{ color: "#79b8ff", fontSize: 13, marginRight: 16 }}>
            читать источник →
          </a>
        )}
        <button onClick={() => handleQuick("like")} disabled={sent || inflight} aria-label="Нравится" style={chipBtn(expandedFeedback === "like" ? "#3fb950" : "#a0a8b0")}>
          👍
        </button>
        <button onClick={() => handleQuick("dislike")} disabled={sent || inflight} aria-label="Не нравится" style={chipBtn(expandedFeedback === "dislike" ? "#ff7b72" : "#a0a8b0")}>
          👎
        </button>
        {item.verdict === "borderline" && (
          <span style={{ ...chip, color: "#e3b341", borderColor: "#5a4717" }}>borderline</span>
        )}
      </div>
      {expandedFeedback && !sent && (
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
          Почему? (опционально)
          <div>
            {(expandedFeedback === "like" ? LIKE_REASONS : DISLIKE_REASONS).map((r) => (
              <button key={r} onClick={() => handleReason(r)} style={chipBtn("#a0a8b0")}>{r}</button>
            ))}
          </div>
        </div>
      )}
      {sent && (
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.6 }}>Спасибо за фидбэк.</div>
      )}
    </article>
  );
}

function DebugPanel({ prompt, decisions }: { prompt: PromptData | null; decisions: NewsItem[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => {
    const s = new Set(expanded);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setExpanded(s);
  };
  return (
    <>
      {prompt && (
        <>
          <div style={card}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Статистика</h2>
            <pre style={codeBox}>{JSON.stringify(prompt.stats, null, 2)}</pre>
            <div style={{ opacity: 0.6, fontSize: 12, marginTop: 6 }}>Модель валидатора: {prompt.model}</div>
          </div>
          <div style={card}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Текущий профиль</h2>
            <pre style={codeBox}>{JSON.stringify(prompt.profile, null, 2)}</pre>
          </div>
          <div style={card}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Собранный промт (пример)</h2>
            <div style={{ opacity: 0.6, fontSize: 12, marginBottom: 6 }}>SYSTEM:</div>
            <pre style={codeBox}>{prompt.sample_prompt.system}</pre>
            <div style={{ opacity: 0.6, fontSize: 12, margin: "10px 0 6px" }}>USER (на примере фейкового поста):</div>
            <pre style={codeBox}>{prompt.sample_prompt.user}</pre>
          </div>
        </>
      )}
      <div style={card}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Последние решения валидатора ({decisions.length})</h2>
        {decisions.length === 0 && <p style={{ opacity: 0.6 }}>Пока пусто.</p>}
        {decisions.map((d) => (
          <div key={d.id} style={{ borderBottom: "1px solid #232a33", paddingBottom: 10, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontSize: 13 }}>
                <b>{verdictLabel(d.verdict, d.status)}</b> · {d.source.name} · {d.relevance ?? "—"}/100
              </div>
              <button onClick={() => toggle(d.id)} style={{ fontSize: 12, background: "transparent", border: "1px solid #232a33", color: "#a0a8b0", padding: "2px 8px", borderRadius: 4, cursor: "pointer" }}>
                {expanded.has(d.id) ? "свернуть" : "развернуть"}
              </button>
            </div>
            <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>{d.title || "(без заголовка)"}</div>
            {d.reasoning && <div style={{ fontSize: 12, opacity: 0.6, fontStyle: "italic", marginTop: 4 }}>{d.reasoning}</div>}
            {d.validation_error && <div style={{ fontSize: 12, color: "#ff7b72", marginTop: 4 }}>ошибка: {d.validation_error}</div>}
            {expanded.has(d.id) && (
              <>
                <div style={{ opacity: 0.6, fontSize: 12, margin: "8px 0 4px" }}>INPUT:</div>
                <pre style={codeBox}>{d.validation_input ?? "—"}</pre>
                <div style={{ opacity: 0.6, fontSize: 12, margin: "8px 0 4px" }}>OUTPUT:</div>
                <pre style={codeBox}>{d.validation_output_json ?? "—"}</pre>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function verdictLabel(v: NewsItem["verdict"], status: string): string {
  if (status === "failed") return "FAILED";
  if (!v) return status.toUpperCase();
  return v.toUpperCase();
}
