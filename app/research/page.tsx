import { checkAdminTokenValue } from "@/lib/auth";
import { Card } from "@/components/ui";
import { listRuns } from "@/lib/research/store";
import type { RunRow } from "@/lib/research/types";
import StartForm from "./StartForm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SP = Record<string, string | string[] | undefined>;
function pickStr(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const wrap: React.CSSProperties = { maxWidth: 1040, margin: "0 auto", padding: "48px 32px 64px" };

export default async function ResearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const token = pickStr(sp.token);
  const auth = checkAdminTokenValue(token);

  if (!auth.ok) {
    return (
      <div style={wrap}>
        <h1 style={{ marginTop: 0 }}>Глубокие исследования</h1>
        <Card>
          <p style={{ marginTop: 0 }}>
            Доступ закрыт: <b>{auth.reason}</b>.
          </p>
          {auth.status === 503 ? (
            <p style={{ color: "var(--text-muted)" }}>
              Задайте <code>ADMIN_TOKEN</code> в env на сервере.
            </p>
          ) : (
            <form method="get" style={{ display: "flex", gap: 8, marginTop: 8, maxWidth: 420 }}>
              <input type="password" name="token" placeholder="admin token" style={inputCss} />
              <button type="submit" style={btnCss}>Войти</button>
            </form>
          )}
        </Card>
      </div>
    );
  }

  let runs: RunRow[] = [];
  let loadError: string | null = null;
  try {
    runs = await listRuns(50);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div style={wrap}>
      <h1 style={{ marginTop: 0, marginBottom: 4 }}>Глубокие исследования</h1>
      <p style={{ color: "var(--text-secondary)", marginTop: 0, marginBottom: 24 }}>
        Итеративный агент: декомпозиция цели → веб-поиск → извлечение факторов → реестр
        находок. Дерево рассуждений можно обходить вживую.
      </p>

      <StartForm token={token ?? ""} />

      {loadError && (
        <Card style={{ borderColor: "var(--danger)", marginTop: 20 }}>
          Ошибка загрузки: {loadError}
        </Card>
      )}

      <h2 style={{ fontSize: "var(--text-lg)", marginTop: 28, marginBottom: 12 }}>Прогоны</h2>
      {runs.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>Пока нет прогонов. Запустите первый выше.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {runs.map((r) => (
            <a
              key={r.id}
              href={`/research/${r.id}?token=${encodeURIComponent(token ?? "")}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <Card interactive as="div" style={{ display: "block", textAlign: "left", width: "100%" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={chip(r.status)}>{r.status}</span>
                  <span style={{ flex: 1, minWidth: 200 }}>{r.goal}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
                    узлов {r.stats.nodesExpanded} · факторов {r.stats.findings} · ${r.stats.costUsd.toFixed(3)}
                  </span>
                </div>
              </Card>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

const inputCss: React.CSSProperties = {
  flex: 1,
  padding: "8px 10px",
  background: "var(--bg-subtle)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
};
const btnCss: React.CSSProperties = {
  padding: "8px 16px",
  background: "var(--accent)",
  border: 0,
  borderRadius: "var(--radius)",
  color: "var(--text-on-accent)",
  cursor: "pointer",
};

function chip(status: string): React.CSSProperties {
  const map: Record<string, { c: string; b: string }> = {
    running: { c: "var(--info)", b: "var(--info-bg)" },
    done: { c: "var(--success)", b: "var(--success-bg)" },
    error: { c: "var(--danger)", b: "var(--danger-bg)" },
    pending: { c: "var(--text-muted)", b: "var(--bg-subtle)" },
  };
  const s = map[status] ?? map.pending;
  return {
    background: s.b,
    color: s.c,
    fontSize: "var(--text-xs)",
    padding: "2px 8px",
    borderRadius: "var(--radius-full)",
    whiteSpace: "nowrap",
  };
}
