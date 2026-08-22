"use client";

import { useState, useTransition } from "react";
import { Button, Card, Input } from "@/components/ui";
import type { AdapterSourceRow } from "@/lib/adapters/types";
import type { ContextStats } from "@/lib/adapters/stats";

const code: React.CSSProperties = {
  background: "var(--bg-subtle)",
  padding: "1px 6px",
  borderRadius: 4,
  fontFamily: "var(--font-mono)",
  fontSize: "0.9em",
};

type Kind = "gmail" | "gcal" | "notion" | "slack" | "telegram";

interface Integration {
  kind: Kind;
  title: string;
  description: string;
  defaultId: string;
  defaultInterval: number;
  connect: "google_oauth" | "token" | "soon";
  tokenLabel?: string;
  tokenField?: string;
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
    description:
      "Страницы workspace. Internal Integration Token из настроек Notion.",
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

type Status = "idle" | "syncing" | "error" | "disabled";

function StatusBadge({
  status,
}: {
  status: Status | "not-connected" | "soon";
}) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    idle: {
      label: "подключён",
      color: "var(--success)",
      bg: "var(--success-bg)",
    },
    syncing: {
      label: "синкается",
      color: "var(--warning)",
      bg: "var(--warning-bg)",
    },
    error: { label: "ошибка", color: "var(--danger)", bg: "var(--danger-bg)" },
    disabled: {
      label: "выкл",
      color: "var(--text-muted)",
      bg: "var(--bg-subtle)",
    },
    "not-connected": {
      label: "не подключён",
      color: "var(--text-muted)",
      bg: "var(--bg-subtle)",
    },
    soon: { label: "скоро", color: "var(--text-muted)", bg: "var(--bg-subtle)" },
  };
  const m = map[status];
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 500,
        padding: "2px 8px",
        borderRadius: 999,
        color: m.color,
        background: m.bg,
        whiteSpace: "nowrap",
      }}
    >
      {m.label}
    </span>
  );
}

export default function AdaptersClient({
  token,
  sources,
  recentRuns,
  stats,
  flash,
}: {
  token: string;
  sources: AdapterSourceRow[];
  recentRuns: RunRow[];
  stats: ContextStats;
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
        (json &&
        typeof json === "object" &&
        "error" in (json as Record<string, unknown>)
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

  async function action(
    id: string,
    op: "enable" | "disable" | "sync_now" | "reset_cursor",
  ) {
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
      await request(`/api/admin/adapters/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      reload();
    } catch (err) {
      setMsg(
        `${id} delete: ${err instanceof Error ? err.message : String(err)}`,
      );
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
      await request(
        `/api/admin/adapters/${encodeURIComponent(integ.defaultId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: "sync_now" }),
        },
      );
      setTokenInputs((prev) => ({ ...prev, [integ.kind]: "" }));
      setMsg(`${integ.title}: подключён, первый sync запущен`);
      reload();
    } catch (err) {
      setMsg(`${integ.title}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  const isError = msg && /ошиб|error|fail/i.test(msg);

  return (
    <>
      {msg && (
        <Card
          padded
          style={{
            marginBottom: 20,
            borderColor: isError ? "var(--danger)" : "var(--success)",
            background: isError ? "var(--danger-bg)" : "var(--success-bg)",
            color: isError ? "var(--danger)" : "var(--success)",
          }}
        >
          {msg}
        </Card>
      )}

      <Card padded style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0, marginBottom: 4, fontSize: 18 }}>
          Интеграции
        </h2>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: 13,
            marginTop: 0,
            marginBottom: 16,
          }}
        >
          Подключи сервис — система начнёт читать оттуда контекст и сохранять в
          БД. Cron <span style={code}>* * * * *</span> синкает каждый источник
          по его расписанию.
        </p>

        <div
          style={{
            display: "flex",
            gap: 24,
            padding: "12px 16px",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <Stat label="В контексте" value={fmtNum(stats.total)} unit="сниппетов" />
          <Stat label="За 24 часа" value={`+${fmtNum(stats.last24h)}`} unit="новых" />
          <Stat
            label="Активных источников"
            value={String(
              sources.filter(
                (s) => !!s.credentials && s.status !== "disabled",
              ).length,
            )}
            unit={`из ${INTEGRATIONS.length}`}
          />
        </div>
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
            const status: Status | "not-connected" | "soon" = connected
              ? (existing!.status as Status)
              : integ.connect === "soon"
                ? "soon"
                : "not-connected";
            return (
              <div
                key={integ.kind}
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-lg)",
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                    {integ.title}
                  </h3>
                  <StatusBadge status={status} />
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  {integ.description}
                </div>

                {connected && existing && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {(() => {
                      const s = stats.bySource[integ.kind];
                      if (!s) return null;
                      return (
                        <div
                          style={{
                            marginBottom: 4,
                            color: "var(--text-secondary)",
                            fontWeight: 500,
                          }}
                        >
                          сохранено: {fmtNum(s.total)}
                          {s.last24h > 0 && (
                            <span style={{ color: "var(--success)" }}>
                              {" "}
                              · за 24ч +{fmtNum(s.last24h)}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    последний sync: {fmtTs(existing.last_run_at)}
                    {existing.next_run_at && (
                      <> · следующий: {fmtTs(existing.next_run_at)}</>
                    )}
                    {existing.last_error && (
                      <div style={{ color: "var(--danger)", marginTop: 4 }}>
                        {existing.last_error.slice(0, 160)}
                      </div>
                    )}
                  </div>
                )}

                {!connected && integ.connect === "google_oauth" && (
                  <a
                    href={`/api/oauth/google/start?source_id=${encodeURIComponent(
                      integ.defaultId,
                    )}&kind=${encodeURIComponent(
                      integ.kind,
                    )}&token=${encodeURIComponent(token)}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "var(--space-2)",
                      height: 32,
                      padding: "0 var(--space-4)",
                      fontSize: "var(--text-base)",
                      fontWeight: 500,
                      borderRadius: "var(--radius)",
                      background: "var(--accent)",
                      color: "var(--text-on-accent)",
                      border: "1px solid var(--accent)",
                      textDecoration: "none",
                      width: "100%",
                    }}
                  >
                    Подключить через Google
                  </a>
                )}

                {!connected && integ.connect === "token" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <Input
                      type="password"
                      placeholder={integ.tokenPlaceholder}
                      value={tokenInputs[integ.kind] ?? ""}
                      onChange={(e) =>
                        setTokenInputs((prev) => ({
                          ...prev,
                          [integ.kind]: e.target.value,
                        }))
                      }
                    />
                    <Button
                      variant="primary"
                      size="md"
                      loading={busy === integ.kind + ":save"}
                      onClick={() => saveToken(integ)}
                    >
                      Подключить
                    </Button>
                  </div>
                )}

                {!connected && integ.connect === "soon" && (
                  <Button variant="secondary" size="md" disabled>
                    Скоро
                  </Button>
                )}

                {connected && existing && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={busy === existing.id + ":sync_now"}
                      onClick={() => action(existing.id, "sync_now")}
                    >
                      Синкнуть сейчас
                    </Button>
                    {integ.connect === "google_oauth" && (
                      <a
                        href={`/api/oauth/google/start?source_id=${encodeURIComponent(
                          existing.id,
                        )}&kind=${encodeURIComponent(
                          existing.kind,
                        )}&token=${encodeURIComponent(token)}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          height: 28,
                          padding: "0 var(--space-3)",
                          fontSize: "var(--text-sm)",
                          fontWeight: 500,
                          borderRadius: "var(--radius)",
                          background: "var(--bg)",
                          color: "var(--text)",
                          border: "1px solid var(--border-strong)",
                          textDecoration: "none",
                        }}
                      >
                        Переподключить
                      </a>
                    )}
                    {existing.status === "disabled" ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy === existing.id + ":enable"}
                        onClick={() => action(existing.id, "enable")}
                      >
                        Включить
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy === existing.id + ":disable"}
                        onClick={() => action(existing.id, "disable")}
                      >
                        Выкл
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      size="sm"
                      loading={busy === existing.id + ":delete"}
                      onClick={() => removeSource(existing.id)}
                    >
                      Отключить
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card padded>
        <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 18 }}>
          Журнал sync&apos;ов
        </h2>
        {recentRuns.length === 0 ? (
          <p style={{ color: "var(--text-muted)", margin: 0 }}>
            Пока пусто — подключи источник.
          </p>
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
                    <td
                      style={{
                        ...td,
                        color:
                          r.status === "error"
                            ? "var(--danger)"
                            : "var(--success)",
                        fontWeight: 500,
                      }}
                    >
                      {r.status}
                    </td>
                    <td style={td}>{r.fetched_count}</td>
                    <td style={td}>
                      {r.duration_ms != null ? r.duration_ms + "ms" : "—"}
                    </td>
                    <td
                      style={{
                        ...td,
                        color: "var(--danger)",
                        maxWidth: 320,
                        fontSize: 12,
                      }}
                    >
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
      </Card>
    </>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
  fontSize: 12,
  color: "var(--text-muted)",
  fontWeight: 500,
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
  fontSize: 13,
  verticalAlign: "top",
};

function fmtTs(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace("T", " ").replace("Z", "").slice(0, 19);
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("ru-RU").format(n);
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.2 }}>
        {value}
        {unit && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 400,
              color: "var(--text-muted)",
              marginLeft: 6,
            }}
          >
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}
