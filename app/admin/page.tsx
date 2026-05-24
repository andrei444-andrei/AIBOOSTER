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

export default async function AdminPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const token = pickStr(sp.token);
  const auth = checkAdminTokenValue(token);

  if (!auth.ok) {
    return (
      <main style={wrap}>
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
                  padding: "8px 10px",
                  background: "#0b0d10",
                  border: "1px solid #232a33",
                  borderRadius: 6,
                  color: "#e6e8eb",
                }}
              />
              <button
                type="submit"
                style={{
                  padding: "8px 16px",
                  background: "#2b6cb0",
                  border: 0,
                  borderRadius: 6,
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Войти
              </button>
            </form>
          )}
        </div>
      </main>
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

  return (
    <main style={wrap}>
      <h1 style={{ marginBottom: 4 }}>AIBOOSTER · /admin</h1>
      <p style={{ opacity: 0.6, marginTop: 0 }}>
        Структура и данные БД (read-only). Логи — таблица <span style={code}>app_errors</span>,
        также через <span style={code}>GET /api/admin/errors</span>.
      </p>

      {introspectError && (
        <div style={{ ...card, borderColor: "#7a2b2b" }}>
          Ошибка интроспекции БД: <span style={code}>{introspectError}</span>
        </div>
      )}

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Таблицы</h2>
        {tables.map((t) => (
          <div key={t.name} style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <a href={linkFor({ table: t.name, page: 1 })} style={{ color: "#79b8ff", fontWeight: 600 }}>
                {t.name}
              </a>
              <span style={{ opacity: 0.5, fontSize: 13 }}>
                строк: {t.rowCount < 0 ? "?" : t.rowCount}
              </span>
              {!t.knownInRegistry && (
                <span style={{ color: "#e3b341", fontSize: 12 }}>нет в реестре schema.ts</span>
              )}
            </div>
            <div style={{ opacity: 0.75, fontSize: 13, margin: "4px 0 8px" }}>{t.description}</div>
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
                    <td style={{ ...td, opacity: 0.7 }}>
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
            <div style={{ color: "#ff7b72" }}>{tablePageError}</div>
          ) : tablePage ? (
            <>
              <div style={{ opacity: 0.6, fontSize: 13, marginBottom: 8 }}>
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
                  <a href={linkFor({ table: selectedTable, page: tablePage.page - 1 })} style={{ color: "#79b8ff" }}>
                    ← предыдущая
                  </a>
                )}
                {tablePage.page * tablePage.pageSize < tablePage.total && (
                  <a href={linkFor({ table: selectedTable, page: tablePage.page + 1 })} style={{ color: "#79b8ff" }}>
                    следующая →
                  </a>
                )}
              </div>
            </>
          ) : null}
        </section>
      )}
    </main>
  );
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "object") return JSON.stringify(value);
  const s = String(value);
  return s.length > 300 ? s.slice(0, 300) + "…" : s;
}
