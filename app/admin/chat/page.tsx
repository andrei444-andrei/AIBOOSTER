import { checkAdminTokenValue } from "@/lib/auth";
import { getSettings } from "@/lib/chat";
import { ChatSettingsForm } from "./ChatSettingsForm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SP = Record<string, string | string[] | undefined>;
function pickStr(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const wrap: React.CSSProperties = { maxWidth: 880, margin: "0 auto", padding: "32px 24px" };
const card: React.CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: 20,
  marginBottom: 20,
};
const code: React.CSSProperties = {
  background: "var(--bg-subtle)",
  padding: "1px 5px",
  borderRadius: 4,
  fontFamily: "var(--font-mono)",
};

export default async function AdminChatPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const token = pickStr(sp.token);
  const auth = checkAdminTokenValue(token);

  if (!auth.ok) {
    return (
      <main style={wrap}>
        <h1>AIBOOSTER · /admin/chat</h1>
        <div style={card}>
          <p>Доступ закрыт: <b>{auth.reason}</b>.</p>
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
      </main>
    );
  }

  const settings = await getSettings();

  return (
    <main style={wrap}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>AI Chat — настройки</h1>
        <a href={`/admin?token=${encodeURIComponent(token ?? "")}`} style={{ color: "var(--text-muted)", fontSize: 13 }}>
          ← /admin
        </a>
      </div>
      <p style={{ color: "var(--text-secondary)", marginTop: 0 }}>
        Системный промт и набор разрешённых блоков форматирования. Применяется ко всем чатам в <span style={code}>/chat</span>.
      </p>

      <ChatSettingsForm initial={settings} token={token ?? ""} />
    </main>
  );
}
