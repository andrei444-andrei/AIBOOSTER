"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card, Button } from "@/components/ui";
import s from "./news-card.module.css";

const wrap: React.CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "32px 24px 80px",
};

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: "6px 14px",
  background: active ? "var(--text)" : "transparent",
  border: "1px solid " + (active ? "var(--text)" : "var(--border)"),
  borderRadius: 999,
  color: active ? "var(--text-on-accent)" : "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "inherit",
  fontWeight: 500,
});

type Tab = "feed" | "skipped" | "debug";

interface Enrichment {
  status: "pending" | "running" | "done" | "failed";
  article_body: string | null;
  key_facts: string[];
  sources_used: Array<{ url: string; title: string; role?: string; why_relevant: string }>;
  images: Array<{ url: string; caption: string; source_url: string }>;
  original_source_url: string | null;
  synthesis_output_json: string | null;
  model_used: string | null;
  cost_cents: number | null;
  latency_ms: number | null;
  completed_at: string | null;
  synthesis_error: string | null;
}

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
  enrichment: Enrichment | null;
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

  // Auto-poll каждые 25 сек: pending/running enrichments сами подтянутся.
  useEffect(() => {
    if (tab !== "feed") return;
    const id = setInterval(() => {
      const hasPending = items.some(
        (it) => it.enrichment && (it.enrichment.status === "pending" || it.enrichment.status === "running"),
      );
      void loadFeed();
      if (hasPending) {
        void fetch("/api/news/enrich/tick").catch(() => {});
      }
    }, 25_000);
    return () => clearInterval(id);
  }, [tab, items, loadFeed]);

  // При первой загрузке: pending → пинаем enrich-tick.
  useEffect(() => {
    if (tab !== "feed" || items.length === 0) return;
    const hasPending = items.some(
      (it) => it.enrichment && (it.enrichment.status === "pending" || it.enrichment.status === "running"),
    );
    if (hasPending) {
      void fetch("/api/news/enrich/tick").catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

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
      <header style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Лента</h1>
          <nav style={{ display: "flex", gap: 14, fontSize: 13 }}>
            <Link href="/news/sources" style={{ color: "var(--text-secondary)" }}>источники</Link>
            <Link href="/news/profile" style={{ color: "var(--text-secondary)" }}>профиль</Link>
            <Link href="/news/agent-log" style={{ color: "var(--text-secondary)" }}>агент 🤖</Link>
          </nav>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={tabBtn(tab === "feed")} onClick={() => setTab("feed")}>лента</button>
          <button style={tabBtn(tab === "skipped")} onClick={() => setTab("skipped")}>отсеяно</button>
          <button style={tabBtn(tab === "debug")} onClick={() => setTab("debug")}>отладка</button>
        </div>
      </header>

      {error && (
        <Card padded style={{ borderColor: "var(--danger)", marginBottom: 16 }}>
          <span style={{ color: "var(--danger)" }}>Ошибка: {error}</span>
        </Card>
      )}

      {tab === "feed" && (
        <FeedList items={items} loading={loading} onFeedback={sendFeedback} />
      )}
      {tab === "skipped" && <SkippedList items={skipped} loading={loading} onPromote={promote} />}
      {tab === "debug" && <DebugPanel prompt={promptData} decisions={decisions} loading={loading} />}
    </main>
  );
}

function FeedList({
  items,
  loading,
  onFeedback,
}: {
  items: NewsItem[];
  loading: boolean;
  onFeedback: (id: string, s: "like" | "dislike", r?: string) => void;
}) {
  if (loading && items.length === 0) {
    return <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Загрузка…</div>;
  }
  if (items.length === 0) {
    return (
      <Card padded>
        <p style={{ marginTop: 0 }}>В ленте пусто.</p>
        <p style={{ color: "var(--text-secondary)" }}>
          Cron-tick запускается раз в 10 минут. Можно дёрнуть руками или подождать.
        </p>
      </Card>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {items.map((it) => (
        <Story key={it.id} item={it} onFeedback={onFeedback} />
      ))}
    </div>
  );
}

function Story({
  item,
  onFeedback,
}: {
  item: NewsItem;
  onFeedback: (id: string, s: "like" | "dislike", r?: string) => void;
}) {
  const [expanded, setExpanded] = useState<null | "like" | "dislike">(null);
  const [sent, setSent] = useState(false);
  const [inflight, setInflight] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);

  const e = item.enrichment;
  const hasBody = !!e?.article_body;
  const isDone = e?.status === "done" && hasBody;
  const isRefreshing =
    e && (e.status === "pending" || e.status === "running") && hasBody;
  const isPending =
    e && (e.status === "pending" || e.status === "running") && !hasBody;
  const isFailed = e?.status === "failed" && !hasBody;

  // Parsed enrichment fields from synthesis_output_json
  const synth = parseSynthesis(e?.synthesis_output_json ?? null);

  const handleQuick = (sig: "like" | "dislike") => {
    if (sent || inflight) return;
    setInflight(true);
    setExpanded(sig);
    void onFeedback(item.id, sig);
  };
  const handleReason = (r: string) => {
    if (!expanded || sent) return;
    void onFeedback(item.id, expanded, r);
    setSent(true);
  };

  // Подсчёт времени чтения по article_body
  const readingMin =
    e?.article_body ? Math.max(2, Math.round(e.article_body.length / 1500)) : null;

  // Final display data
  const displayHeadline = (synth.headline || item.title || "").trim();
  const displayLead = synth.lead || item.summary || item.value_explanation || "";
  const heroImg = e?.images?.[0];

  return (
    <article className={s.story}>
      {/* META: topics + published time + source + reading time */}
      <div className={s.metaRow}>
        {(item.matched_topics ?? []).slice(0, 3).map((t) => (
          <span key={t} className={s.topicChip}>{t}</span>
        ))}
        {readingMin && (
          <>
            <span className={s.metaDot} />
            <span>{readingMin} мин чтения</span>
          </>
        )}
        <span className={s.metaDot} />
        <span>
          {item.source.name}
          {item.published_at && ` · ${relativeTime(item.published_at)}`}
        </span>
        {isDone && <><span className={s.metaDot} /><span>🤖 AI-разбор</span></>}
      </div>

      {/* HEADLINE */}
      <h2 className={s.headline}>{displayHeadline || "(без заголовка)"}</h2>

      {/* LEAD */}
      {displayLead && <p className={s.lead}>{displayLead}</p>}

      {/* Refresh indicator */}
      {isRefreshing && (
        <div className={s.refreshing}>
          <span className={s.spinner} /> обновляется с новым pipeline…
        </div>
      )}

      {/* HERO IMAGE — большая, при наличии */}
      {(isDone || isRefreshing) && heroImg && (
        <figure className={s.hero}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={heroImg.url}
            alt={heroImg.caption || ""}
            onError={(ev) => { (ev.target as HTMLImageElement).style.display = "none"; }}
          />
          {heroImg.caption && (
            <figcaption className={s.heroCaption}>{heroImg.caption}</figcaption>
          )}
        </figure>
      )}

      {/* KEY FACTS — pull-quote callout */}
      {(isDone || isRefreshing) && e!.key_facts.length > 0 && (
        <div className={s.keyFacts}>
          <div className={s.keyFactsLabel}>Главное</div>
          <ul className={s.keyFactsList}>
            {(fullOpen ? e!.key_facts : e!.key_facts.slice(0, 5)).map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {/* PENDING — нет body */}
      {isPending && (
        <div className={s.pending}>
          <span className={s.spinner} />
          <span>Собираю полную статью — Perplexity + Opus + Vision. Готова через ~1 минуту.</span>
        </div>
      )}

      {/* FAILED — нет body */}
      {isFailed && e?.synthesis_error && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          ⚠ Не собралась: {e.synthesis_error.slice(0, 200)}
        </div>
      )}

      {/* FULL ARTICLE — only when expanded */}
      {fullOpen && (isDone || isRefreshing) && e?.article_body && (
        <>
          <div className={s.body}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{e.article_body}</ReactMarkdown>
          </div>

          {synth.quotes.length > 0 && (
            <section className={s.quotes}>
              {synth.quotes.map((q, i) => (
                <blockquote key={i} className={s.quote}>
                  <p className={s.quoteText}>«{q.text}»</p>
                  {(q.attribution || q.source_url) && (
                    <footer className={s.quoteAttr}>
                      {q.attribution}
                      {q.source_url && (
                        <a href={q.source_url} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }}>↗</a>
                      )}
                    </footer>
                  )}
                </blockquote>
              ))}
            </section>
          )}

          {synth.timeline.length > 0 && (
            <section>
              <div className={s.keyFactsLabel} style={{ marginBottom: 12 }}>Хронология</div>
              <ul className={s.timeline}>
                {synth.timeline.map((t, i) => (
                  <li key={i}>
                    <span className={s.timelineDate}>{t.date}</span>{t.event}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {synth.implications && (
            <div className={s.implications}>
              <div className={s.implicationsLabel}>Что это значит для вас</div>
              <div className={s.implicationsBody}>{synth.implications}</div>
            </div>
          )}

          {e.sources_used.length > 0 && (
            <section>
              <div className={s.keyFactsLabel} style={{ marginBottom: 10 }}>
                Источники ({e.sources_used.length})
              </div>
              <div className={s.sources}>
                {e.sources_used.map((src, i) => (
                  <div key={i} className={s.sourceLine}>
                    {src.role === "original" && (
                      <span className={s.sourceRoleOriginal}>ОРИГИНАЛ</span>
                    )}
                    <a href={src.url} target="_blank" rel="noreferrer" className={s.sourceLink}>
                      {src.title || src.url}
                    </a>
                    {src.why_relevant && (
                      <span className={s.sourceWhy}>· {src.why_relevant}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className={s.metaSmall}>
            {e.model_used}
            {e.cost_cents != null && ` · ${(e.cost_cents / 100).toFixed(2)}¢`}
            {e.latency_ms != null && ` · ${(e.latency_ms / 1000).toFixed(1)}s`}
            {synth.quality_note && ` · ${synth.quality_note}`}
          </div>
        </>
      )}

      {/* FOOTER: feedback + expand toggle */}
      <div className={s.footer}>
        <div className={s.feedbackLine}>
          <span className={s.feedbackLabel}>Полезно?</span>
          <button
            className={`${s.feedbackBtn} ${expanded === "like" ? s.feedbackBtnActive : ""}`}
            onClick={() => handleQuick("like")}
            disabled={sent || inflight}
            aria-label="Нравится"
          >👍</button>
          <button
            className={`${s.feedbackBtn} ${expanded === "dislike" ? s.feedbackBtnActive : ""}`}
            onClick={() => handleQuick("dislike")}
            disabled={sent || inflight}
            aria-label="Не нравится"
          >👎</button>
          {expanded && !sent && (
            <div className={s.reasonChips}>
              {(expanded === "like" ? LIKE_REASONS : DISLIKE_REASONS).map((r) => (
                <button key={r} className={s.reasonChip} onClick={() => handleReason(r)}>
                  {r}
                </button>
              ))}
            </div>
          )}
          {sent && (
            <span style={{ fontSize: 12, color: "var(--success)" }}>Спасибо.</span>
          )}
        </div>
        {(isDone || isRefreshing) && e?.article_body && (
          <button className={s.toggleFull} onClick={() => setFullOpen(!fullOpen)}>
            {fullOpen ? "свернуть" : "читать полностью →"}
          </button>
        )}
      </div>
    </article>
  );
}

function SkippedList({
  items,
  loading,
  onPromote,
}: {
  items: NewsItem[];
  loading: boolean;
  onPromote: (id: string) => void;
}) {
  if (loading && items.length === 0) {
    return <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Загрузка…</div>;
  }
  if (items.length === 0) {
    return <Card padded><p style={{ marginTop: 0 }}>Отсеянных нет.</p></Card>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
        Посты, которые валидатор пометил skip. «Показать в ленте» — сигнал для калибровки.
      </p>
      {items.map((it) => (
        <article key={it.id} className={s.story} style={{ padding: "16px 18px" }}>
          <div className={s.metaRow}>
            <span>{it.source.name}</span>
            <span className={s.metaDot} />
            <span>relevance {it.relevance ?? "—"}/100</span>
          </div>
          <h3 style={{ fontSize: 18, lineHeight: 1.3, margin: "8px 0 0", fontWeight: 600 }}>
            {it.title || "(без заголовка)"}
          </h3>
          {it.summary && (
            <p style={{ color: "var(--text-secondary)", fontSize: 14, margin: "8px 0 0" }}>{it.summary}</p>
          )}
          {it.reasoning && (
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "8px 0 0", fontStyle: "italic" }}>
              Причина: {it.reasoning}
            </p>
          )}
          <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center" }}>
            {it.url && (
              <a href={it.url} target="_blank" rel="noreferrer" style={{ color: "var(--text-secondary)", fontSize: 13, borderBottom: "1px solid var(--border)" }}>
                читать источник →
              </a>
            )}
            <button className={s.toggleFull} onClick={() => onPromote(it.id)}>
              показать в ленте
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function DebugPanel({
  prompt,
  decisions,
  loading,
}: {
  prompt: PromptData | null;
  decisions: NewsItem[];
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => {
    const s = new Set(expanded);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setExpanded(s);
  };
  if (loading && !prompt) {
    return <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Загрузка…</div>;
  }
  const codeBox: React.CSSProperties = {
    background: "var(--bg-subtle)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: 10,
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: 400,
    overflow: "auto",
    color: "var(--text)",
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
        </>
      )}
      <Card padded>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Последние решения валидатора ({decisions.length})</h2>
        {decisions.map((d) => (
          <div key={d.id} style={{ borderBottom: "1px solid var(--border)", paddingBottom: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontSize: 13 }}>
                <b>{(d.verdict ?? d.status).toUpperCase()}</b>
                <span style={{ color: "var(--text-muted)" }}> · {d.source.name} · {d.relevance ?? "—"}/100</span>
              </div>
              <button className={s.toggleFull} onClick={() => toggle(d.id)}>
                {expanded.has(d.id) ? "свернуть" : "развернуть"}
              </button>
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

// ---------- helpers ----------

interface SynthFields {
  headline: string | null;
  lead: string | null;
  implications: string | null;
  quotes: Array<{ text: string; attribution: string; source_url?: string }>;
  timeline: Array<{ date: string; event: string }>;
  quality_note: string | null;
}
function parseSynthesis(json: string | null): SynthFields {
  const empty: SynthFields = { headline: null, lead: null, implications: null, quotes: [], timeline: [], quality_note: null };
  if (!json) return empty;
  try {
    const j = JSON.parse(json) as Record<string, unknown>;
    return {
      headline: typeof j.headline === "string" ? j.headline : null,
      lead: typeof j.lead === "string" ? j.lead : null,
      implications: typeof j.implications === "string" ? j.implications : null,
      quotes: Array.isArray(j.quotes) ? (j.quotes as Array<{ text: string; attribution: string; source_url?: string }>) : [],
      timeline: Array.isArray(j.timeline) ? (j.timeline as Array<{ date: string; event: string }>) : [],
      quality_note: typeof j.quality_note === "string" ? j.quality_note : null,
    };
  } catch {
    return empty;
  }
}

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}ч назад`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}д назад`;
  return new Date(t).toLocaleDateString("ru-RU");
}
