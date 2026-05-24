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

type Kind = "gmail" | "gcal" | "notion" | "slack" | "telegram";

interface Integration {
  kind: Kind;
  title: string;
  description: string;
  defaultId: string;
  defaultInterval: number;
  // Способ подключения:
  //   'google_oauth' — редирект на /api/oauth/google/start
  //   'token' — компактная форма ввода токена
  //   'soon' — заглушка пока нет адаптера
  connect: "google_oauth" | "token" | "soon";
  tokenLabel?: string; // для connect='token'
  tokenField?: string; // ключ в credentials JSON
  tokenPlaceholder?: string;
  notes?: string;
}

const INTEGRATIONS: Integration[] = [
  {
    kind: "gmail",
    title: "Gmail",
    description:
      "Письма из инбокса. Инкрементально через history.list, читается тело + заголовки.",
    defaultId: "gmail",
    defaultInterval: 120,
    connect: "google_oauth",
  },
  {
    kind: "gcal",
    title: "Google Calendar",
    description: "События календаря. Тот же Google-аккаунт, что и Gmail.",
    defaultId: "gcal",
    defaultInterval: 300,
    connect: "soon",
    notes: "адаптер скоро",
  },
  {
    kind: "telegram",
    title: "Telegram (Bot)",
    description:
      "Сообщения, отправленные/пересланные боту. Нужен бот @BotFather → токен.",
    defaultId: "telegram",
    defaultInterval: 120,
    connect: "token",
    tokenLabel: "Bot token",
    tokenField: "bot_token",
    tokenPlaceholder: "123456789:ABC-DEF...",
    notes: "адаптер скоро",
  },
  {
    kind: "notion",
    title: "Notion",
    description: "Страницы workspace. Internal Integration Token из настроек Notion.",
    defaultId: "notion",
    defaultInterval: 1800,
    connect: "token",
    tokenLabel: "Integration token",
    tokenField: "integration_token",
    tokenPlaceholder: "secret_...",
    notes: "адаптер скоро",
  },
  {
    kind: "slack",
    title: "Slack",
    description: "Сообщения в каналах и DM. OAuth с user-scopes.",
    defaultId: "slack",
    defaultInterval: 300,
    connect: "soon",
    notes: "адаптер скоро",
  },
];

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
  flash,
}: {
  token: string;
  sources: AdapterSourceRow[];
  recentRuns: RunRow[];
  flash: string | null;
}) {
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(flash);
  const [tokenInputs, setTokenInputs] = useState<Record<string, string>>({});

  const sourcesByKind: Partial<Record<Kind, AdapterSourceRow>> = {};
  for (const s of sources) {
    sourcesByKind[s.kind as Kind] = s;
  }

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
    if (!confirm(`Отключить ${id}? Сохранённые данные останутся в БД.`)) {
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

  async function saveToken(integ: Integration) {
    const value = (tokenInputs[integ.kind] ?? "").trim();
    if (!value) {
      setMsg(`${integ.title}: введите ${integ.tokenLabel}`);
      return;
    }
    setBusy(integ.kind + ":save");
    setMsg(null);
    try {
      await request("/api/admin/adapters", {
        method: "POST",
        body: JSON.stringify({
          id: integ.defaultId,
          kind: integ.kind,
          display_name: integ.title,
          interval_sec: integ.defaultInterval,
          credentials: { [integ.tokenField ?? "token"]: value },
        }),
      });
      // Сразу запускаем первый sync.
      await request(`/api/admin/adapters/${encodeURIComponent(integ.defaultId)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "sync_now" }),
      });
      setTokenInputs((prev) => ({ ...prev, [integ.kind]: "" }));
      setMsg(`${integ.title}: подключён, первый sync запущен`);
      reload();
    } catch (err) {
      setMsg(`${integ.title}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {msg && (
        <div
          style={{
            ...card,
            borderColor: /ошиб|error|fail|ok|подключ|sync/.test(msg)
              ? msg.includes("error") || msg.includes("ошиб") || msg.includes("fail")
                ? "#7a2b2b"
                : "#2b6cb0"
              : "#2b6cb0",
          }}
        >
          {msg}
        </div>
      )}

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Интеграции</h2>
        <p style={{ opacity: 0.6, fontSize: 13, marginTop: 0 }}>
          Подключи сервис — система начнёт читать оттуда контекст и сохранять в БД.
          Cron <span style={code}>* * * * *</span> синкает каждый источник по его расписанию.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 12,
          }}
        >
          {INTEGRATIONS.map((integ) => {
            const existing = sourcesByKind[integ.kind];
            const connected = !!existing && !!existing.credentials;
            return (
              <div
                key={integ.kind}
                style={{
                  background: "#0b0d10",
                  border: "1px solid #232a33",
                  borderRadius: 8,
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 15 }}>{integ.title}</h3>
                  {connected ? (
                    existing!.status === "error" ? (
                      <span style={{ fontSize: 11, color: "#ff7b72" }}>● ошибка</span>
                    ) : existing!.status === "syncing" ? (
                      <span style={{ fontSize: 11, color: "#e3b341" }}>● синкается</span>
                    ) : existing!.status === "disabled" ? (
                      <span style={{ fontSize: 11, color: "#999" }}>● выкл</span>
                    ) : (
                      <span style={{ fontSize: 11, color: "#7ee787" }}>● подключён</span>
                    )
                  ) : integ.connect === "soon" ? (
                    <span style={{ fontSize: 11, opacity: 0.5 }}>скоро</span>
                  ) : (
                    <span style={{ fontSize: 11, opacity: 0.5 }}>не подключён</span>
                  )}
                </div>
                <div style={{ fontSize: 13, opacity: 0.75, lineHeight: 1.4 }}>
                  {integ.description}
                </div>

                {connected && existing && (
                  <div style={{ fontSize: 12, opacity: 0.6 }}>
                    последний sync: {fmtTs(existing.last_run_at)}
                    {existing.next_run_at && (
                      <>
                        {" "}· следующий: {fmtTs(existing.next_run_at)}
                      </>
                    )}
                    {existing.last_error && (
                      <div style={{ color: "#ff7b72", marginTop: 4 }}>
                        {existing.last_error.slice(0, 160)}
                      </div>
                    )}
                  </div>
                )}

                {/* Действия */}
                {!connected && integ.connect === "google_oauth" && (
                  <a
                    href={`/api/oauth/google/start?source_id=${encodeURIComponent(
                      integ.defaultId,
                    )}&kind=${encodeURIComponent(
                      integ.kind,
                    )}&token=${encodeURIComponent(token)}`}
                    style={{ ...btnPrimary, textAlign: "center", textDecoration: "none" }}
                  >
                    Подключить через Google
                  </a>
                )}

                {!connected && integ.connect === "token" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <input
                      type="password"
                      placeholder={integ.tokenPlaceholder}
                      value={tokenInputs[integ.kind] ?? ""}
                      onChange={(e) =>
                        setTokenInputs((prev) => ({
                          ...prev,
                          [integ.kind]: e.target.value,
                        }))
                      }
                      style={{ ...input, width: "100%" }}
                    />
                    <button
                      style={btnPrimary}
                      disabled={busy === integ.kind + ":save"}
                      onClick={() => saveToken(integ)}
                    >
                      {busy === integ.kind + ":save" ? "..." : `Подключить`}
                    </button>
                  </div>
                )}

                {!connected && integ.connect === "soon" && (
                  <button disabled style={{ ...btn, opacity: 0.5, cursor: "not-allowed" }}>
                    скоро
                  </button>
                )}

                {connected && existing && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      style={btnPrimary}
                      disabled={busy === existing.id + ":sync_now"}
                      onClick={() => action(existing.id, "sync_now")}
                    >
                      синкнуть сейчас
                    </button>
                    {integ.connect === "google_oauth" && (
                      <a
                        href={`/api/oauth/google/start?source_id=${encodeURIComponent(
                          existing.id,
                        )}&kind=${encodeURIComponent(
                          existing.kind,
                        )}&token=${encodeURIComponent(token)}`}
                        style={{ ...btn, textDecoration: "none" }}
                      >
                        переподключить
                      </a>
                    )}
                    {existing.status === "disabled" ? (
                      <button
                        style={btn}
                        disabled={busy === existing.id + ":enable"}
                        onClick={() => action(existing.id, "enable")}
                      >
                        включить
                      </button>
                    ) : (
                      <button
                        style={btn}
                        disabled={busy === existing.id + ":disable"}
                        onClick={() => action(existing.id, "disable")}
                      >
                        выкл
                      </button>
                    )}
                    <button
                      style={btnDanger}
                      disabled={busy === existing.id + ":delete"}
                      onClick={() => removeSource(existing.id)}
                    >
                      отключить
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Журнал sync'ов</h2>
        {recentRuns.length === 0 ? (
          <p style={{ opacity: 0.6 }}>Пока пусто — подключи источник.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>finished</th>
                  <th style={th}>source</th>
                  <th style={th}>kind</th>
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
                    <td style={{ ...td, color: r.status === "error" ? "#ff7b72" : "#7ee787" }}>
                      {r.status}
                    </td>
                    <td style={td}>{r.fetched_count}</td>
                    <td style={td}>{r.duration_ms != null ? r.duration_ms + "ms" : "—"}</td>
                    <td style={{ ...td, color: "#ff7b72", maxWidth: 320, fontSize: 12 }}>
                      {r.error_message
                        ? r.error_message.length > 160
                          ? r.error_message.slice(0, 160) + "…"
                          : r.error_message
                        : ""}
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
