"use client";

import { useState, useTransition } from "react";
import type { AdapterSourceRow } from "@/lib/adapters/types";

const card: React.CSSProperties = {
  background: "#12161c",
  border: "1px solid #232a33",
  borderRadius: 10,
  padding: 16,
  marginBottom: 20,
};
const th: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 10px",
  borderBottom: "1px solid #232a33",
  fontSize: 13,
  opacity: 0.7,
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "6px 10px",
  borderBottom: "1px solid #1a1e24",
  fontSize: 13,
  verticalAlign: "top",
};
const code: React.CSSProperties = {
  background: "#1a1e24",
  padding: "1px 5px",
  borderRadius: 4,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};
const btn: React.CSSProperties = {
  padding: "4px 10px",
  background: "#1a1e24",
  border: "1px solid #2c333d",
  borderRadius: 6,
  color: "#e6e8eb",
  cursor: "pointer",
  fontSize: 12,
};
const btnPrimary: React.CSSProperties = {
  ...btn,
  background: "#2b6cb0",
  borderColor: "#2b6cb0",
  color: "#fff",
};
const btnDanger: React.CSSProperties = {
  ...btn,
  borderColor: "#7a2b2b",
};
const input: React.CSSProperties = {
  padding: "6px 8px",
  background: "#0b0d10",
  border: "1px solid #232a33",
  borderRadius: 6,
  color: "#e6e8eb",
  fontSize: 13,
};

const KINDS = ["gmail", "notion", "slack", "telegram", "gcal"] as const;
type Kind = (typeof KINDS)[number];

const DEFAULT_INTERVAL: Record<Kind, number> = {
  gmail: 120,
  notion: 1800,
  slack: 300,
  telegram: 120,
  gcal: 300,
};

interface RunRow {
  id: string;
  source_id: string;
  kind: string;
  job_kind: string;
  started_at: string;
  finished_at: string;
  duration_ms: number | null;
  fetched_count: number;
  status: string;
  error_message: string | null;
}

export default function AdaptersClient({
  token,
  sources,
  recentRuns,
}: {
  token: string;
  sources: AdapterSourceRow[];
  recentRuns: RunRow[];
}) {
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Форма «добавить источник»
  const [newKind, setNewKind] = useState<Kind>("gmail");
  const [newId, setNewId] = useState<string>("gmail");
  const [newName, setNewName] = useState<string>("");
  const [newInterval, setNewInterval] = useState<number>(DEFAULT_INTERVAL.gmail);
  const [newCreds, setNewCreds] = useState<string>("");

  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("x-admin-token", token);
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const res = await fetch(path, { ...init, headers });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // оставляем null
    }
    if (!res.ok) {
      const err =
        (json && typeof json === "object" && "error" in (json as Record<string, unknown>)
          ? String((json as Record<string, unknown>).error)
          : text) || `${res.status}`;
      throw new Error(err);
    }
    return json;
  }

  function reload() {
    startTransition(() => {
      window.location.reload();
    });
  }

  async function action(id: string, op: "enable" | "disable" | "sync_now" | "reset_cursor") {
    setBusy(id + ":" + op);
    setMsg(null);
    try {
      await request(`/api/admin/adapters/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: op }),
      });
      setMsg(`${id}: ${op} ok`);
      reload();
    } catch (err) {
      setMsg(`${id} ${op}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function removeSource(id: string) {
    if (!confirm(`Удалить источник ${id}? Данные в context_snippets и per-source таблицах останутся.`)) {
      return;
    }
    setBusy(id + ":delete");
    try {
      await request(`/api/admin/adapters/${encodeURIComponent(id)}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setMsg(`${id} delete: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function createSource(e: React.FormEvent) {
    e.preventDefault();
    setBusy("new");
    setMsg(null);
    try {
      let credentials: unknown = undefined;
      if (newCreds.trim()) {
        try {
          credentials = JSON.parse(newCreds);
        } catch {
          throw new Error("credentials должны быть валидным JSON");
        }
      }
      await request("/api/admin/adapters", {
        method: "POST",
        body: JSON.stringify({
          id: newId.trim(),
          kind: newKind,
          display_name: newName.trim() || null,
          interval_sec: newInterval,
          credentials,
        }),
      });
      setNewCreds("");
      reload();
    } catch (err) {
      setMsg(`create: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {msg && (
        <div style={{ ...card, borderColor: msg.includes("ok") ? "#2b6cb0" : "#7a2b2b" }}>
          {msg}
        </div>
      )}

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Источники</h2>
        {sources.length === 0 ? (
          <p style={{ opacity: 0.6 }}>Пока ни один источник не подключён. Добавь ниже.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>id</th>
                  <th style={th}>kind</th>
                  <th style={th}>status</th>
                  <th style={th}>интервал</th>
                  <th style={th}>last_run</th>
                  <th style={th}>next_run</th>
                  <th style={th}>creds</th>
                  <th style={th}>cursor</th>
                  <th style={th}>last_error</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id}>
                    <td style={td}>
                      <span style={code}>{s.id}</span>
                      {s.display_name && (
                        <div style={{ opacity: 0.6, fontSize: 12 }}>{s.display_name}</div>
                      )}
                    </td>
                    <td style={td}>{s.kind}</td>
                    <td style={td}>
                      <span
                        style={{
                          ...code,
                          color:
                            s.status === "error"
                              ? "#ff7b72"
                              : s.status === "disabled"
                                ? "#999"
                                : s.status === "syncing"
                                  ? "#e3b341"
                                  : "#7ee787",
                        }}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td style={td}>{s.interval_sec}s</td>
                    <td style={td}>{fmtTs(s.last_run_at)}</td>
                    <td style={td}>{fmtTs(s.next_run_at)}</td>
                    <td style={td}>{s.credentials ? "✓" : "—"}</td>
                    <td style={td}>{s.cursor ? "✓" : "—"}</td>
                    <td style={{ ...td, color: "#ff7b72", maxWidth: 220, fontSize: 12 }}>
                      {s.last_error
                        ? s.last_error.length > 120
                          ? s.last_error.slice(0, 120) + "…"
                          : s.last_error
                        : ""}
                    </td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <button
                          style={btnPrimary}
                          disabled={busy === s.id + ":sync_now"}
                          onClick={() => action(s.id, "sync_now")}
                        >
                          sync now
                        </button>
                        {s.status === "disabled" ? (
                          <button
                            style={btn}
                            disabled={busy === s.id + ":enable"}
                            onClick={() => action(s.id, "enable")}
                          >
                            enable
                          </button>
                        ) : (
                          <button
                            style={btn}
                            disabled={busy === s.id + ":disable"}
                            onClick={() => action(s.id, "disable")}
                          >
                            disable
                          </button>
                        )}
                        <button
                          style={btn}
                          disabled={busy === s.id + ":reset_cursor"}
                          onClick={() => action(s.id, "reset_cursor")}
                        >
                          reset cursor
                        </button>
                        <button
                          style={btnDanger}
                          disabled={busy === s.id + ":delete"}
                          onClick={() => removeSource(s.id)}
                        >
                          delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Добавить / обновить источник</h2>
        <form onSubmit={createSource} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label>
              <div style={{ opacity: 0.6, fontSize: 12, marginBottom: 4 }}>kind</div>
              <select
                value={newKind}
                onChange={(e) => {
                  const k = e.target.value as Kind;
                  setNewKind(k);
                  setNewId(k);
                  setNewInterval(DEFAULT_INTERVAL[k]);
                }}
                style={input}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ flex: 1, minWidth: 180 }}>
              <div style={{ opacity: 0.6, fontSize: 12, marginBottom: 4 }}>
                id (уникальный, обычно совпадает с kind)
              </div>
              <input
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                style={{ ...input, width: "100%" }}
              />
            </label>
            <label style={{ flex: 1, minWidth: 180 }}>
              <div style={{ opacity: 0.6, fontSize: 12, marginBottom: 4 }}>
                display_name (опц.)
              </div>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="например, work@example.com"
                style={{ ...input, width: "100%" }}
              />
            </label>
            <label>
              <div style={{ opacity: 0.6, fontSize: 12, marginBottom: 4 }}>interval, сек</div>
              <input
                type="number"
                min={30}
                value={newInterval}
                onChange={(e) => setNewInterval(parseInt(e.target.value, 10) || 600)}
                style={{ ...input, width: 100 }}
              />
            </label>
          </div>
          <label>
            <div style={{ opacity: 0.6, fontSize: 12, marginBottom: 4 }}>
              credentials JSON (формат специфичен для адаптера; пустое — оставить старое)
            </div>
            <textarea
              value={newCreds}
              onChange={(e) => setNewCreds(e.target.value)}
              placeholder='{"access_token": "...", "refresh_token": "..."}'
              rows={4}
              style={{ ...input, width: "100%", fontFamily: "ui-monospace, monospace" }}
            />
          </label>
          <div>
            <button type="submit" disabled={busy === "new"} style={btnPrimary}>
              {busy === "new" ? "..." : "сохранить"}
            </button>
          </div>
        </form>
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Последние запуски (журнал)</h2>
        {recentRuns.length === 0 ? (
          <p style={{ opacity: 0.6 }}>Журнал пуст.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>finished</th>
                  <th style={th}>source</th>
                  <th style={th}>kind</th>
                  <th style={th}>job_kind</th>
                  <th style={th}>status</th>
                  <th style={th}>fetched</th>
                  <th style={th}>длит.</th>
                  <th style={th}>ошибка</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{fmtTs(r.finished_at)}</td>
                    <td style={td}>
                      <span style={code}>{r.source_id}</span>
                    </td>
                    <td style={td}>{r.kind}</td>
                    <td style={td}>{r.job_kind}</td>
                    <td style={{ ...td, color: r.status === "error" ? "#ff7b72" : "#7ee787" }}>
                      {r.status}
                    </td>
                    <td style={td}>{r.fetched_count}</td>
                    <td style={td}>{r.duration_ms != null ? r.duration_ms + "ms" : "—"}</td>
                    <td style={{ ...td, color: "#ff7b72", maxWidth: 320, fontSize: 12 }}>
                      {r.error_message ? (
                        r.error_message.length > 160
                          ? r.error_message.slice(0, 160) + "…"
                          : r.error_message
                      ) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function fmtTs(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace("T", " ").replace("Z", "").slice(0, 19);
}
