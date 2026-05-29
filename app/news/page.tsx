"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, Button } from "@/components/ui";

const wrap: React.CSSProperties = {
  maxWidth: 1000,
  margin: "0 auto",
  padding: "48px 32px 64px",
};

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  background: active ? "var(--bg-subtle)" : "transparent",
  border: "1px solid var(--border)",
  borderRight: "none",
  color: active ? "var(--text)" : "var(--text-secondary)",
  cursor: "pointer",
  fontSize: "var(--text-sm)",
  fontFamily: "inherit",
});

const chip: React.CSSProperties = {
  display: "inline-block",
  fontSize: 12,
  padding: "2px 8px",
  borderRadius: 99,
  background: "var(--bg-subtle)",
  border: "1px solid var(--border)",
  marginRight: 6,
  marginTop: 4,
  color: "var(--text-secondary)",
};

const codeBox: React.CSSProperties = {
  background: "var(--bg-subtle)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: 10,
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 400,
  overflow: "auto",
  color: "var(--text)",
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
  has_enrichment?: boolean;
}

interface Enrichment {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  summary: string | null;
  key_facts: string[];
  sources_used: Array<{ url: string; title: string; why_relevant: string }>;
  model_used: string | null;
  cost_cents: number | null;
  latency_ms: number | null;
  created_at: string;
  completed_at: string | null;
  synthesis_error: string | null;
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
  const [tab, setTab] = useState<Tab>("feed");
  const [items, setItems] = useState<NewsItem[]>([]);
  const [skipped, setSkipped] = useState<NewsItem[]>([]);
  const [decisions, setDecisions] = useState<NewsItem[]>([]);
  const [promptData, setPromptData] = useState<PromptData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/news/items?verdict=show&limit=100");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setItems(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSkipped = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/news/items/skipped?limit=100");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setSkipped(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDebug = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pr, dr] = await Promise.all([
        fetch("/api/news/prompt"),
        fetch("/api/news/decisions?limit=50"),
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
  }, []);

  useEffect(() => {
    if (tab === "feed") void loadFeed();
    else if (tab === "skipped") void loadSkipped();
    else void loadDebug();
  }, [tab, loadFeed, loadSkipped, loadDebug]);

  const sendFeedback = async (item_id: string, signal: "like" | "dislike", reason?: string) => {
    try {
      await fetch("/api/news/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item_id, signal, reason_chip: reason ?? null }),
      });
    } catch (e) {
      console.error("feedback failed", e);
    }
  };

  const promote = async (item_id: string) => {
    const prev = skipped;
    setSkipped(skipped.filter((x) => x.id !== item_id));
    try {
      const r = await fetch("/api/news/items/promote", {
        method: "POST",
        headers: { "content-type": "application/json" },
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

  return (
    <main style={wrap}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px" }}>
            Модуль · Новости
          </p>
          <h1 style={{ fontSize: 32, lineHeight: 1.15, margin: 0 }}>Персональная лента</h1>
        </div>
        <nav style={{ fontSize: "var(--text-sm)", display: "flex", gap: 16 }}>
          <Link href="/news/sources" style={{ color: "var(--text-secondary)", textDecoration: "none", borderBottom: "1px solid var(--border)" }}>
            источники →
          </Link>
          <Link href="/news/profile" style={{ color: "var(--text-secondary)", textDecoration: "none", borderBottom: "1px solid var(--border)" }}>
            профиль →
          </Link>
        </nav>
      </header>

      <div style={{ display: "flex", marginBottom: 24 }}>
        <button style={{ ...tabBtn(tab === "feed"), borderTopLeftRadius: 6, borderBottomLeftRadius: 6 }} onClick={() => setTab("feed")}>Лента</button>
        <button style={tabBtn(tab === "skipped")} onClick={() => setTab("skipped")}>Отсеяно</button>
        <button style={{ ...tabBtn(tab === "debug"), borderRight: "1px solid var(--border)", borderTopRightRadius: 6, borderBottomRightRadius: 6 }} onClick={() => setTab("debug")}>Отладка</button>
      </div>

      {error && (
        <Card padded style={{ borderColor: "var(--danger)", marginBottom: 16 }}>
          <span style={{ color: "var(--danger)" }}>Ошибка: {error}</span>
        </Card>
      )}
      {loading && <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>Загрузка…</div>}

      {tab === "feed" && <FeedList items={items} onFeedback={sendFeedback} />}
      {tab === "skipped" && <SkippedList items={skipped} onPromote={promote} />}
      {tab === "debug" && <DebugPanel prompt={promptData} decisions={decisions} />}
    </main>
  );
}

function FeedList({ items, onFeedback }: { items: NewsItem[]; onFeedback: (id: string, s: "like" | "dislike", r?: string) => void }) {
  if (items.length === 0) {
    return (
      <Card padded>
        <p style={{ marginTop: 0 }}>В ленте пусто.</p>
        <p style={{ color: "var(--text-secondary)" }}>
          Это нормально на чистой БД. Cron-tick запускается раз в 10 минут.
          Также все валидированные посты могут быть в «Отсеяно» — открой и посмотри.
        </p>
        <pre style={codeBox}>{`curl -X POST $APP/api/news/cron/tick`}</pre>
      </Card>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {items.map((it) => <ItemCard key={it.id} item={it} onFeedback={onFeedback} />)}
    </div>
  );
}

function SkippedList({ items, onPromote }: { items: NewsItem[]; onPromote: (id: string) => void }) {
  if (items.length === 0) {
    return (
      <Card padded>
        <p style={{ marginTop: 0 }}>Отсеянных нет.</p>
      </Card>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
        Посты, которые валидатор пометил как skip. Если что-то реально полезное здесь —
        нажми «показать в ленте», это сигнал для калибровки промта.
      </p>
      {items.map((it) => (
        <Card key={it.id} padded>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 600 }}>{it.title || "(без заголовка)"}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              {it.source.name} · {it.relevance ?? "—"}/100
            </div>
          </div>
          {it.summary && <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginTop: 6 }}>{it.summary}</div>}
          {it.reasoning && (
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8, fontStyle: "italic" }}>
              Причина: {it.reasoning}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            {(it.matched_topics ?? []).map((t) => <span key={t} style={chip}>{t}</span>)}
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}>
            {it.url && (
              <a href={it.url} target="_blank" rel="noreferrer" style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", borderBottom: "1px solid var(--border)" }}>
                читать источник →
              </a>
            )}
            <Button variant="secondary" size="sm" onClick={() => onPromote(it.id)}>
              показать в ленте
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ItemCard({ item, onFeedback }: { item: NewsItem; onFeedback: (id: string, s: "like" | "dislike", r?: string) => void }) {
  const [expandedFeedback, setExpandedFeedback] = useState<null | "like" | "dislike">(null);
  const [sent, setSent] = useState(false);
  const [inflight, setInflight] = useState(false);
  const [enrichmentOpen, setEnrichmentOpen] = useState(false);
  const [enrichment, setEnrichment] = useState<Enrichment | null>(null);
  const [enrichmentLoading, setEnrichmentLoading] = useState(false);

  const handleQuick = (s: "like" | "dislike") => {
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

  const loadEnrichment = async () => {
    if (enrichment || enrichmentLoading) {
      setEnrichmentOpen(!enrichmentOpen);
      return;
    }
    setEnrichmentLoading(true);
    setEnrichmentOpen(true);
    try {
      const r = await fetch(`/api/news/enrichment?item_id=${encodeURIComponent(item.id)}`);
      const data = await r.json();
      setEnrichment(data.enrichment);
    } catch {
      // soft: бейдж не появится без has_enrichment, но если кликнули - сообщение об ошибке необязательно
    } finally {
      setEnrichmentLoading(false);
    }
  };

  return (
    <Card padded>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 17, fontWeight: 600, flex: 1 }}>
          {item.title || "(без заголовка)"}
          {item.has_enrichment && (
            <span style={{
              marginLeft: 8,
              fontSize: 11,
              fontWeight: 500,
              padding: "2px 8px",
              borderRadius: 99,
              color: "var(--info)",
              background: "var(--info-bg)",
              verticalAlign: "middle",
            }}>
              🔍 углублено
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          {item.source.name} · {item.relevance ?? "—"}/100
        </div>
      </div>
      {item.summary && (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 8 }}>{item.summary}</div>
      )}
      {item.value_explanation && (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 10, paddingLeft: 12, borderLeft: "2px solid var(--info)" }}>
          <b style={{ color: "var(--text)" }}>Почему вам:</b> {item.value_explanation}
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        {(item.matched_topics ?? []).map((t) => <span key={t} style={chip}>{t}</span>)}
      </div>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {item.url && (
          <a href={item.url} target="_blank" rel="noreferrer" style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", borderBottom: "1px solid var(--border)", marginRight: 8 }}>
            читать источник →
          </a>
        )}
        <Button variant={expandedFeedback === "like" ? "primary" : "secondary"} size="sm" onClick={() => handleQuick("like")} disabled={sent || inflight} aria-label="Нравится">
          👍
        </Button>
        <Button variant={expandedFeedback === "dislike" ? "primary" : "secondary"} size="sm" onClick={() => handleQuick("dislike")} disabled={sent || inflight} aria-label="Не нравится">
          👎
        </Button>
        {item.verdict === "borderline" && (
          <span style={{ ...chip, color: "var(--warning)", borderColor: "var(--warning)", background: "var(--warning-bg)" }}>borderline</span>
        )}
      </div>
      {expandedFeedback && !sent && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>
          <span>Почему? (опционально)</span>
          <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(expandedFeedback === "like" ? LIKE_REASONS : DISLIKE_REASONS).map((r) => (
              <Button key={r} variant="secondary" size="sm" onClick={() => handleReason(r)}>{r}</Button>
            ))}
          </div>
        </div>
      )}
      {sent && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--success)" }}>Спасибо за фидбэк.</div>
      )}
      {item.has_enrichment && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <button
            onClick={loadEnrichment}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--info)",
              cursor: "pointer",
              fontSize: "var(--text-sm)",
              padding: 0,
              fontFamily: "inherit",
            }}
          >
            {enrichmentOpen ? "▼ свернуть углубление" : "▶ показать углубление (Opus + web search)"}
          </button>
          {enrichmentOpen && (
            <div style={{ marginTop: 10 }}>
              {enrichmentLoading && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Загружаю…</div>}
              {!enrichmentLoading && enrichment && enrichment.summary && (
                <>
                  <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--text)" }}>
                    {enrichment.summary}
                  </div>
                  {enrichment.key_facts.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                        Ключевые факты
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "var(--text-secondary)" }}>
                        {enrichment.key_facts.map((f, i) => <li key={i} style={{ marginBottom: 4 }}>{f}</li>)}
                      </ul>
                    </div>
                  )}
                  {enrichment.sources_used.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                        Источники ({enrichment.sources_used.length})
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                        {enrichment.sources_used.map((s, i) => (
                          <li key={i} style={{ marginBottom: 6 }}>
                            <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
                              {s.title || s.url}
                            </a>
                            {s.why_relevant && <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>— {s.why_relevant}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-muted)" }}>
                    {enrichment.model_used} · {enrichment.cost_cents != null ? `${(enrichment.cost_cents / 100).toFixed(2)}¢` : "?"} · {enrichment.latency_ms != null ? `${(enrichment.latency_ms / 1000).toFixed(1)}s` : "?"}
                  </div>
                </>
              )}
              {!enrichmentLoading && enrichment && !enrichment.summary && (
                <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  Углубление не удалось: {enrichment.synthesis_error ?? "неизвестная ошибка"}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {prompt && (
        <>
          <Card padded>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Статистика</h2>
            <pre style={codeBox}>{JSON.stringify(prompt.stats, null, 2)}</pre>
            <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 8 }}>Модель валидатора: {prompt.model}</div>
          </Card>
          <Card padded>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Текущий профиль</h2>
            <pre style={codeBox}>{JSON.stringify(prompt.profile, null, 2)}</pre>
          </Card>
          <Card padded>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Собранный промт (пример)</h2>
            <div style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 6 }}>SYSTEM:</div>
            <pre style={codeBox}>{prompt.sample_prompt.system}</pre>
            <div style={{ color: "var(--text-muted)", fontSize: 12, margin: "10px 0 6px" }}>USER (на фейковом посте):</div>
            <pre style={codeBox}>{prompt.sample_prompt.user}</pre>
          </Card>
        </>
      )}
      <Card padded>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Последние решения валидатора ({decisions.length})</h2>
        {decisions.length === 0 && <p style={{ color: "var(--text-muted)" }}>Пока пусто.</p>}
        {decisions.map((d) => (
          <div key={d.id} style={{ borderBottom: "1px solid var(--border)", paddingBottom: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <div style={{ fontSize: 13 }}>
                <b>{verdictLabel(d.verdict, d.status)}</b>
                <span style={{ color: "var(--text-muted)" }}> · {d.source.name} · {d.relevance ?? "—"}/100</span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => toggle(d.id)}>
                {expanded.has(d.id) ? "свернуть" : "развернуть"}
              </Button>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>{d.title || "(без заголовка)"}</div>
            {d.reasoning && <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", marginTop: 4 }}>{d.reasoning}</div>}
            {d.validation_error && <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>ошибка: {d.validation_error}</div>}
            {expanded.has(d.id) && (
              <>
                <div style={{ color: "var(--text-muted)", fontSize: 12, margin: "8px 0 4px" }}>INPUT:</div>
                <pre style={codeBox}>{d.validation_input ?? "—"}</pre>
                <div style={{ color: "var(--text-muted)", fontSize: 12, margin: "8px 0 4px" }}>OUTPUT:</div>
                <pre style={codeBox}>{d.validation_output_json ?? "—"}</pre>
              </>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}

function verdictLabel(v: NewsItem["verdict"], status: string): string {
  if (status === "failed") return "FAILED";
  if (!v) return status.toUpperCase();
  return v.toUpperCase();
}
