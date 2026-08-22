import { checkAdminTokenValue } from "@/lib/auth";
import { listSources } from "@/lib/adapters/sources";
import { getContextStats } from "@/lib/adapters/stats";
import { getDb, ensureSchema } from "@/lib/db";
import AdaptersClient from "./AdaptersClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SP = Record<string, string | string[] | undefined>;

function pickStr(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const wrap: React.CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
  padding: "32px 24px",
};
const card: React.CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: 20,
  marginBottom: 20,
};
const code: React.CSSProperties = {
  background: "var(--bg-subtle)",
  padding: "1px 6px",
  borderRadius: 4,
  fontFamily: "var(--font-mono)",
  fontSize: "0.9em",
};

export default async function AdaptersPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const token = pickStr(sp.token);
  const auth = checkAdminTokenValue(token);

  if (!auth.ok) {
    return (
      <main style={wrap}>
        <h1>AIBOOSTER · /admin/adapters</h1>
        <div style={card}>
          <p style={{ marginTop: 0 }}>
            Доступ закрыт: <b>{auth.reason}</b>.
          </p>
          {auth.status === 503 ? (
            <p style={{ color: "var(--text-secondary)" }}>
              Задайте переменную окружения <span style={code}>ADMIN_TOKEN</span>{" "}
              на сервере.
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
      </main>
    );
  }

  let sources: Awaited<ReturnType<typeof listSources>> = [];
  let listError: string | null = null;
  try {
    sources = await listSources();
  } catch (err) {
    listError = err instanceof Error ? err.message : String(err);
  }

  const stats = await getContextStats();

  let recentRuns: Array<{
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
  }> = [];
  try {
    await ensureSchema();
    const db = getDb();
    const res = await db.execute(
      `SELECT id, source_id, kind, job_kind, started_at, finished_at, duration_ms,
              fetched_count, status, error_message
       FROM adapter_sync_runs
       ORDER BY finished_at DESC
       LIMIT 50`,
    );
    recentRuns = res.rows as unknown as typeof recentRuns;
  } catch {
    // Журнал ещё пуст / схема создаётся — не фатально.
  }

  return (
    <main style={wrap}>
      <h1 style={{ marginBottom: 4 }}>AIBOOSTER · /admin/adapters</h1>
      <p style={{ color: "var(--text-secondary)", marginTop: 0, marginBottom: 20 }}>
        Подключённые источники контекста. Cron{" "}
        <span style={code}>/api/adapters/tick</span> раз в минуту ставит
        pull-job&apos;ы. Воркер забирает через{" "}
        <span style={code}>/api/adapters/claim</span>.
      </p>

      {listError && (
        <div
          style={{
            ...card,
            borderColor: "var(--danger)",
            color: "var(--danger)",
            background: "var(--danger-bg)",
          }}
        >
          Ошибка: <span style={code}>{listError}</span>
        </div>
      )}

      <AdaptersClient
        token={token ?? ""}
        sources={sources}
        recentRuns={recentRuns}
        stats={stats}
        flash={pickStr(sp.flash) ?? null}
      />
    </main>
  );
}
