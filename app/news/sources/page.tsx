"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const wrap: React.CSSProperties = { maxWidth: 900, margin: "0 auto", padding: "32px 24px" };
const card: React.CSSProperties = {
  background: "#12161c",
  border: "1px solid #232a33",
  borderRadius: 10,
  padding: 16,
  marginBottom: 16,
};
const input: React.CSSProperties = {
  padding: "8px 10px",
  background: "#0b0d10",
  border: "1px solid #232a33",
  borderRadius: 6,
  color: "#e6e8eb",
  fontSize: 14,
};
const btn: React.CSSProperties = {
  padding: "8px 14px",
  background: "#2b6cb0",
  border: 0,
  borderRadius: 6,
  color: "#fff",
  cursor: "pointer",
  fontSize: 14,
};

interface SourceRow {
  id: string;
  kind: "telegram" | "rss";
  url: string;
  name: string;
  fetch_interval_minutes: number;
  last_fetched_at: string | null;
  apify_run_id: string | null;
  apify_run_status: string | null;
  active: number;
  created_at: string;
}

export default function SourcesPage() {
  const [token, setToken] = useState("");
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"telegram" | "rss">("telegram");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [intervalMin, setIntervalMin] = useState(30);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u = new URL(window.location.href);
    let t = u.searchParams.get("token") ?? "";
    if (!t) {
      try {
        t = window.sessionStorage.getItem("aibooster_token") ?? "";
      } catch {
        /* ignore */
      }
    } else {
      try {
        window.sessionStorage.setItem("aibooster_token", t);
      } catch {
        /* ignore */
      }
      u.searchParams.delete("token");
      window.history.replaceState({}, "", u.toString());
    }
    setToken(t);
  }, []);

  const authHeader = useMemo<Record<string, string>>(
    () => {
      const h: Record<string, string> = {};
      if (token) h.authorization = `Bearer ${token}`;
      return h;
    },
    [token],
  );

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const r = await fetch("/api/news/sources", { headers: authHeader });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setSources(data.sources ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [token, authHeader]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/news/sources", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader },
        body: JSON.stringify({ kind, url, name, fetch_interval_minutes: intervalMin }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setUrl("");
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Удалить источник? Уже собранные посты останутся в БД.")) return;
    await fetch(`/api/news/sources?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeader,
    });
    await load();
  };

  if (!token) {
    return (
      <main style={wrap}>
        <h1>AIBOOSTER · /news/sources</h1>
        <div style={card}>
          <p>Нужен ADMIN_TOKEN в URL: <code>?token=YOUR_TOKEN</code></p>
        </div>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Источники новостей</h1>
        <a href="/news" style={{ color: "#79b8ff", fontSize: 13 }}>← к ленте</a>
      </header>

      <div style={card}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Добавить источник</h2>
        <form onSubmit={submit} style={{ display: "grid", gap: 8, gridTemplateColumns: "120px 1fr 1fr 90px auto" }}>
          <select value={kind} onChange={(e) => setKind(e.target.value as "telegram" | "rss")} style={input}>
            <option value="telegram">telegram</option>
            <option value="rss">rss</option>
          </select>
          <input
            placeholder={kind === "telegram" ? "https://t.me/CHANNEL" : "https://blog.example.com/rss"}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={input}
            required
          />
          <input
            placeholder="имя для UI"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={input}
            required
          />
          <input
            type="number"
            min={5}
            value={intervalMin}
            onChange={(e) => setIntervalMin(parseInt(e.target.value, 10) || 30)}
            style={input}
            title="интервал в минутах"
            aria-label="интервал в минутах"
          />
          <button type="submit" disabled={busy} style={btn}>добавить</button>
        </form>
        {error && <div style={{ color: "#ff7b72", marginTop: 8 }}>{error}</div>}
      </div>

      <div style={card}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Активные источники ({sources.length})</h2>
        {sources.length === 0 && <p style={{ opacity: 0.6 }}>Пусто. Cron-tick засеет дефолты при первом запуске.</p>}
        {sources.map((s) => (
          <div key={s.id} style={{ borderBottom: "1px solid #232a33", padding: "10px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div>
                <span style={{ fontSize: 12, opacity: 0.5, marginRight: 8 }}>[{s.kind}]</span>
                <b>{s.name}</b>
                <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "#79b8ff", fontSize: 13, marginLeft: 10 }}>{s.url}</a>
              </div>
              <button onClick={() => remove(s.id)} style={{ background: "transparent", border: "1px solid #7a2b2b", color: "#ff7b72", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>
                удалить
              </button>
            </div>
            <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
              интервал: {s.fetch_interval_minutes} мин · последний фетч: {s.last_fetched_at ?? "никогда"}
              {s.apify_run_id && ` · apify: ${s.apify_run_status ?? "?"} (${s.apify_run_id})`}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
