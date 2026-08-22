"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, Button } from "@/components/ui";

const wrap: React.CSSProperties = {
  maxWidth: 900,
  margin: "0 auto",
  padding: "32px 24px 80px",
};

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

interface AgentAction {
  id: string;
  type: string;
  target_id: string | null;
  reason: string | null;
  result: "ok" | "skipped" | "error";
  error: string | null;
  applied_at: string;
}

interface AgentRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "done" | "error";
  summary: string | null;
  agent_reasoning: string | null;
  cost_cents: number | null;
  latency_ms: number | null;
  error: string | null;
  actions: AgentAction[];
}

interface ErrorItem {
  id: string;
  source: { name: string; kind: string };
  title: string | null;
  validation_error: string | null;
}

export default function AgentLogPage() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [errorItems, setErrorItems] = useState<ErrorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [triggering, setTriggering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/news/agent-log");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setRuns(data.runs ?? []);
      setErrorItems(data.error_items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const triggerAudit = async () => {
    if (triggering) return;
    setTriggering(true);
    try {
      const r = await fetch("/api/news/agent-audit/tick");
      const data = await r.json();
      if (r.ok) {
        // Через 1s обновим — БД успеет записаться.
        setTimeout(() => void load(), 1000);
      } else {
        setError(`audit error: ${data.error || `HTTP ${r.status}`}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTriggering(false);
    }
  };

  const toggle = (id: string) => {
    const s = new Set(expanded);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setExpanded(s);
  };

  return (
    <main style={wrap}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px" }}>
            Новости · Аудит-агент
          </p>
          <h1 style={{ fontSize: 28, lineHeight: 1.15, margin: 0 }}>История работы агента</h1>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Button onClick={triggerAudit} disabled={triggering}>
            {triggering ? "запускаю…" : "🤖 запустить audit"}
          </Button>
          <Link href="/news" style={{ color: "var(--text-secondary)", fontSize: 13, alignSelf: "center" }}>← к ленте</Link>
        </div>
      </header>

      {error && (
        <Card padded style={{ borderColor: "var(--danger)", marginBottom: 16 }}>
          <span style={{ color: "var(--danger)" }}>Ошибка: {error}</span>
        </Card>
      )}

      {loading && <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Загрузка…</div>}

      {/* ERROR ITEMS — скрытые из ленты */}
      <Card padded style={{ marginBottom: 24 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>
          🗑 Скрыто из ленты ({errorItems.length})
        </h2>
        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 12px" }}>
          Посты с failed enrichment или archived агентом. На главную не выводятся.
        </p>
        {errorItems.length === 0 && (
          <div style={{ color: "var(--text-secondary)", fontSize: 14 }}>Пусто — лента чистая.</div>
        )}
        {errorItems.slice(0, 20).map((it) => (
          <div key={it.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 8 }}>[{it.source.kind}]</span>
                <b style={{ fontSize: 14 }}>{it.title || "(без заголовка)"}</b>
                <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: 12 }}>{it.source.name}</span>
              </div>
            </div>
          </div>
        ))}
        {errorItems.length > 20 && (
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 8 }}>… ещё {errorItems.length - 20}</div>
        )}
      </Card>

      {/* RUNS */}
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 16px" }}>
        Последние audit-runs ({runs.length})
      </h2>

      {runs.length === 0 && !loading && (
        <Card padded>
          <p style={{ marginTop: 0, color: "var(--text-muted)" }}>
            Агент ещё ни разу не запускался. Жми «🤖 запустить audit» или жди cron (каждые 30 мин).
          </p>
        </Card>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {runs.map((r) => {
          const isOpen = expanded.has(r.id);
          const statusColor = r.status === "done" ? "var(--success)" : r.status === "error" ? "var(--danger)" : "var(--text-muted)";
          const okCount = r.actions.filter((a) => a.result === "ok").length;
          const skippedCount = r.actions.filter((a) => a.result === "skipped").length;
          const errorCount = r.actions.filter((a) => a.result === "error").length;
          return (
            <Card key={r.id} padded>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", cursor: "pointer" }}
                onClick={() => toggle(r.id)}
              >
                <div style={{ flex: 1, minWidth: 200 }}>
                  <span style={{ color: statusColor, fontSize: 13, fontWeight: 600 }}>● {r.status}</span>
                  <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: 12 }}>
                    {new Date(r.started_at + (r.started_at.endsWith("Z") ? "" : "Z")).toLocaleString("ru-RU")}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {okCount > 0 && <span style={{ color: "var(--success)" }}>✓ {okCount}</span>}
                  {skippedCount > 0 && <span style={{ marginLeft: 8 }}>↶ {skippedCount}</span>}
                  {errorCount > 0 && <span style={{ marginLeft: 8, color: "var(--danger)" }}>✕ {errorCount}</span>}
                  {r.cost_cents != null && <span style={{ marginLeft: 8 }}>· {(r.cost_cents / 100).toFixed(2)}¢</span>}
                  {r.latency_ms != null && <span style={{ marginLeft: 8 }}>· {(r.latency_ms / 1000).toFixed(1)}s</span>}
                </div>
              </div>
              {r.summary && <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>{r.summary}</div>}
              {r.error && <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>{r.error}</div>}

              {isOpen && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                  {r.agent_reasoning && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                        Reasoning агента
                      </div>
                      <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{r.agent_reasoning}</div>
                    </div>
                  )}

                  {r.actions.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                        Действия ({r.actions.length})
                      </div>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <tbody>
                          {r.actions.map((a) => (
                            <tr key={a.id} style={{ borderBottom: "1px solid var(--border)" }}>
                              <td style={{ padding: "6px 4px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                                <span style={{ color: a.result === "ok" ? "var(--success)" : a.result === "skipped" ? "var(--text-muted)" : "var(--danger)" }}>
                                  {a.result === "ok" ? "✓" : a.result === "skipped" ? "↶" : "✕"}
                                </span>
                              </td>
                              <td style={{ padding: "6px 4px", verticalAlign: "top", whiteSpace: "nowrap", color: "var(--text)" }}>
                                <code style={{ fontSize: 11 }}>{a.type}</code>
                              </td>
                              <td style={{ padding: "6px 4px", verticalAlign: "top", color: "var(--text-secondary)", fontSize: 12 }}>
                                {a.reason}
                                {a.error && (
                                  <div style={{ color: "var(--danger)", marginTop: 2 }}>{a.error}</div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </main>
  );
}
