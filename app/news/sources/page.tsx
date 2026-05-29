"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, Button, Input } from "@/components/ui";

const wrap: React.CSSProperties = {
  maxWidth: 900,
  margin: "0 auto",
  padding: "48px 32px 64px",
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
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [kind, setKind] = useState<"telegram" | "rss">("telegram");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [intervalMin, setIntervalMin] = useState(30);
  const [busy, setBusy] = useState(false);
  const [fetchingId, setFetchingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch("/api/news/sources");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setSources(data.sources ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Submit оптимистичен: бекенд отдаёт вставленную строку, мы добавляем её
  // в локальный state без второго GET. Парсинг новых постов из этого
  // источника пользователь триггерит отдельной кнопкой «Запустить сейчас».
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch("/api/news/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, url, name, fetch_interval_minutes: intervalMin }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      if (data.source) {
        setSources((cur) => [data.source as SourceRow, ...cur]);
      }
      setUrl("");
      setName("");
      setNotice(`добавлено · «Запустить сейчас» — чтобы спарсить посты`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Удалить источник? Уже собранные посты останутся в БД.")) return;
    const prev = sources;
    setSources((cur) => cur.filter((s) => s.id !== id));
    try {
      const r = await fetch(`/api/news/sources?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        setSources(prev);
        const d = await r.json().catch(() => ({}));
        setError(`удалить не получилось: ${d.error ?? r.status}`);
      }
    } catch (e) {
      setSources(prev);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const fetchNow = async (id: string) => {
    if (fetchingId) return;
    setFetchingId(id);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch("/api/news/sources/fetch-one", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      const inserted = typeof data.inserted === "number" ? data.inserted : 0;
      setNotice(
        inserted === 0
          ? `новых постов не нашлось · валидация — на ближайшем cron-тике`
          : `найдено ${inserted} новых · валидация — на ближайшем cron-тике`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetchingId(null);
    }
  };

  const selectStyle: React.CSSProperties = {
    padding: "8px 10px",
    background: "var(--surface)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sm)",
    color: "var(--text)",
    fontSize: "var(--text-sm)",
    fontFamily: "inherit",
  };

  return (
    <main style={wrap}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24, gap: 12, flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px" }}>
            Новости · Источники
          </p>
          <h1 style={{ fontSize: 28, lineHeight: 1.15, margin: 0 }}>Источники новостей</h1>
        </div>
        <Link href="/news" style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", textDecoration: "none", borderBottom: "1px solid var(--border)" }}>
          ← к ленте
        </Link>
      </header>

      <Card padded style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Добавить источник</h2>
        <form onSubmit={submit} style={{ display: "grid", gap: 10, gridTemplateColumns: "120px 1fr 1fr 90px auto", alignItems: "center" }}>
          <select value={kind} onChange={(e) => setKind(e.target.value as "telegram" | "rss")} style={selectStyle} aria-label="Тип источника">
            <option value="telegram">telegram</option>
            <option value="rss">rss</option>
          </select>
          <Input
            placeholder={kind === "telegram" ? "https://t.me/CHANNEL" : "https://blog.example.com/rss"}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            aria-label="URL"
          />
          <Input
            placeholder="имя для UI"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            aria-label="Имя"
          />
          <Input
            type="number"
            min={5}
            value={intervalMin}
            onChange={(e) => setIntervalMin(parseInt(e.target.value, 10) || 30)}
            title="интервал в минутах"
            aria-label="Интервал в минутах"
          />
          <Button type="submit" disabled={busy}>Добавить</Button>
        </form>
        {error && <div style={{ color: "var(--danger)", marginTop: 10, fontSize: "var(--text-sm)" }}>{error}</div>}
        {notice && <div style={{ color: "var(--success)", marginTop: 10, fontSize: "var(--text-sm)" }}>{notice}</div>}
      </Card>

      <Card padded>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Активные источники ({sources.length})</h2>
        {sources.length === 0 && <p style={{ color: "var(--text-muted)" }}>Пусто. Cron-tick засеет дефолты при первом запуске.</p>}
        {sources.map((s) => (
          <div key={s.id} style={{ borderBottom: "1px solid var(--border)", padding: "12px 0", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <div>
                <span style={{ fontSize: 12, color: "var(--text-muted)", marginRight: 8, fontFamily: "var(--font-mono)" }}>[{s.kind}]</span>
                <b>{s.name}</b>
                <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginLeft: 10, borderBottom: "1px solid var(--border)" }}>{s.url}</a>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fetchNow(s.id)}
                  disabled={fetchingId === s.id}
                >
                  {fetchingId === s.id ? "тяну…" : "запустить сейчас"}
                </Button>
                <Button variant="danger" size="sm" onClick={() => remove(s.id)}>удалить</Button>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              интервал: {s.fetch_interval_minutes} мин · последний фетч: {s.last_fetched_at ?? "никогда"}
            </div>
          </div>
        ))}
      </Card>
    </main>
  );
}
