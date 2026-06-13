import { checkAdminTokenValue } from "@/lib/auth";
import { Card } from "@/components/ui";
import TreeView from "./TreeView";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SP = Record<string, string | string[] | undefined>;
function pickStr(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const wrap: React.CSSProperties = { maxWidth: 1200, margin: "0 auto", padding: "32px" };

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const token = pickStr(sp.token);
  const auth = checkAdminTokenValue(token);

  if (!auth.ok) {
    return (
      <div style={wrap}>
        <h1 style={{ marginTop: 0 }}>Прогон исследования</h1>
        <Card>
          <p style={{ marginTop: 0 }}>
            Доступ закрыт: <b>{auth.reason}</b>.
          </p>
          {auth.status !== 503 && (
            <form method="get" style={{ display: "flex", gap: 8, marginTop: 8, maxWidth: 420 }}>
              <input
                type="password"
                name="token"
                placeholder="admin token"
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  color: "var(--text)",
                }}
              />
              <button
                type="submit"
                style={{
                  padding: "8px 16px",
                  background: "var(--accent)",
                  border: 0,
                  borderRadius: "var(--radius)",
                  color: "var(--text-on-accent)",
                  cursor: "pointer",
                }}
              >
                Войти
              </button>
            </form>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <TreeView runId={id} token={token ?? ""} />
    </div>
  );
}
