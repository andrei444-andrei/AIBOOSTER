import { checkAdminTokenValue } from "@/lib/auth";
import { introspect, readTablePage, type LiveTable, type TablePage } from "@/lib/introspect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SP = Record<string, string | string[] | undefined>;

function pickStr(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const wrap: React.CSSProperties = { maxWidth: 1100, margin: "0 auto", padding: "32px 24px" };
const card: React.CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: 20,
  marginBottom: 20,
};
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
const code: React.CSSProperties = {
  background: "var(--bg-subtle)",
  padding: "1px 5px",
  borderRadius: 4,
  fontFamily: "var(--font-mono)",
};

export default async function AdminPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const token = pickStr(sp.token);
  const auth = checkAdminTokenValue(token);

  if (!auth.ok) {
    return (
      <div style={wrap}>
        <h1>AIBOOSTER · /admin</h1>
        <div style={card}>
          <p style={{ marginTop: 0 }}>
            Доступ закрыт: <b>{auth.reason}</b>.
          </p>
          {auth.status === 503 ? (
            <p style={{ opacity: 0.7 }}>
              Задайте переменную окружения <span style={code}>ADMIN_TOKEN</span> на сервере.
            </p>
          ) : (
            <form method="get" style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                type="password"
                name="token"
                placeholder="admin token"
                style={{
                  flex: 1,
                  padding: "0 12px",
                  height: 36,
                  background: "var(--bg)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: "var(--radius)",
                  color: "var(--text)",
                  fontFamily: "inherit",
                  fontSize: 14,
                  outline: "none",
                }}
              />
              <button
                type="submit"
                style={{
                  padding: "0 16px",
                  height: 36,
                  background: "var(--accent)",
                  border: "1px solid var(--accent)",
                  borderRadius: "var(--radius)",
                  color: "var(--text-on-accent)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                Войти
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const selectedTable = pickStr(sp.table);
  const page = parseInt(pickStr(sp.page) ?? "1", 10) || 1;

  let tables: LiveTable[] = [];
  let introspectError: string | null = null;
  try {
    tables = await introspect();
  } catch (err) {
    introspectError = err instanceof Error ? err.message : String(err);
  }

  let tablePage: TablePage | null = null;
  let tablePageError: string | null = null;
  if (selectedTable) {
    try {
      tablePage = await readTablePage(selectedTable, page, 50);
    } catch (err) {
      tablePageError = err instanceof Error ? err.message : String(err);
    }
  }

  const linkFor = (params: Record<string, string | number>) => {
    const u = new URLSearchParams();
    if (token) u.set("token", token);
    for (const [k, v] of Object.entries(params)) u.set(k, String(v));
    return `/admin?${u.toString()}`;
  };

  const adaptersLink = `/admin/adapters${token ? `?token=${encodeURIComponent(token)}` : ""}`;

  return (
    <div style={wrap}>
      <h1 style={{ marginBottom: 4 }}>AIBOOSTER · /admin</h1>
      <p style={{ color: "var(--text-secondary)", marginTop: 0 }}>
        Структура и данные БД (read-only). Логи — таблица <span style={code}>app_errors</span>,
        также через <span style={code}>GET /api/admin/errors</span>.
      </p>
      <p style={{ marginTop: 8 }}>
        →{" "}
        <a href={adaptersLink} style={{ color: "#79b8ff" }}>
          /admin/adapters
        </a>{" "}
        — управление источниками контекста (gmail/notion/slack/telegram/gcal).
      </p>

      <section style={{ ...card, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontWeight: 500 }}>Модули:</span>
        <a
          href={`/admin/chat?token=${encodeURIComponent(token ?? "")}`}
          style={{ color: "var(--text)" }}
        >
          AI Chat — настройки промта и блоков →
        </a>
      </section>

      {introspectError && (
        <div style={{ ...card, borderColor: "var(--danger)", color: "var(--danger)" }}>
          Ошибка интроспекции БД: <span style={code}>{introspectError}</span>
        </div>
      )}

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Таблицы</h2>
        {tables.map((t) => (
          <div key={t.name} style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <a href={linkFor({ table: t.name, page: 1 })} style={{ color: "var(--text)", fontWeight: 600 }}>
                {t.name}
              </a>
              <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
                строк: {t.rowCount < 0 ? "?" : t.rowCount}
              </span>
              {!t.knownInRegistry && (
                <span style={{ color: "var(--warning)", fontSize: 12 }}>нет в реестре schema.ts</span>
              )}
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: 13, margin: "4px 0 8px" }}>{t.description}</div>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>колонка</th>
                  <th style={th}>тип</th>
                  <th style={th}>флаги</th>
                  <th style={th}>описание</th>
                </tr>
              </thead>
              <tbody>
                {t.columns.map((c) => (
                  <tr key={c.name}>
                    <td style={td}>
                      <span style={code}>{c.name}</span>
                    </td>
                    <td style={td}>{c.type || "—"}</td>
                    <td style={{ ...td, color: "var(--text-muted)" }}>
                      {[c.pk ? "PK" : null, c.notNull ? "NOT NULL" : null].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td style={td}>{c.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      {selectedTable && (
        <section style={card}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>
            Данные: <span style={code}>{selectedTable}</span>
          </h2>
          {tablePageError ? (
            <div style={{ color: "var(--danger)" }}>{tablePageError}</div>
          ) : tablePage ? (
            <>
              <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 8 }}>
                всего строк: {tablePage.total} · страница {tablePage.page} · по {tablePage.pageSize}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      {tablePage.columns.map((c) => (
                        <th key={c} style={th}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tablePage.rows.map((row, i) => (
                      <tr key={i}>
                        {tablePage.columns.map((c) => (
                          <td key={c} style={td}>
                            {renderCell(row[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                {tablePage.page > 1 && (
                  <a href={linkFor({ table: selectedTable, page: tablePage.page - 1 })}>
                    ← предыдущая
                  </a>
                )}
                {tablePage.page * tablePage.pageSize < tablePage.total && (
                  <a href={linkFor({ table: selectedTable, page: tablePage.page + 1 })}>
                    следующая →
                  </a>
                )}
              </div>
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "object") return JSON.stringify(value);
  const s = String(value);
  return s.length > 300 ? s.slice(0, 300) + "…" : s;
}
