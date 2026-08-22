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
  kind: "telegram" | "rss" | "web";
  url: string;
  name: string;
  fetch_interval_minutes: number;
  last_fetched_at: string | null;
  active: number;
  created_at: string;
}

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [intervalMin, setIntervalMin] = useState(30);
  const [busy, setBusy] = useState(false);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestResult, setSuggestResult] = useState<{ added: number; skipped: number; topics?: string[] } | null>(null);

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
        body: JSON.stringify({ url, name: name || undefined, fetch_interval_minutes: intervalMin }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      if (data.source) {
        setSources((cur) => [data.source as SourceRow, ...cur]);
      }
      const kindLabel = data.kind === "telegram" ? "Telegram" : data.kind === "rss" ? "RSS" : "сайт (HTML)";
      setUrl("");
      setName("");
      setNotice(`добавлено как ${kindLabel} · нажми «запустить сейчас», чтобы спарсить`);
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

  const autoSuggest = async () => {
    if (suggesting) return;
    setSuggesting(true);
    setSuggestResult(null);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch("/api/news/sources/auto-suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ per_topic: 2, max_add: 30 }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      const added: Array<{ url: string; name: string; topic: string }> = data.added ?? [];
      const skipped: unknown[] = data.skipped ?? [];
      const topics = [...new Set(added.map((a) => a.topic))];
      setSuggestResult({ added: added.length, skipped: skipped.length, topics });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggesting(false);
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

      <Card padded style={{ marginBottom: 16, background: "var(--bg-subtle)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h2 style={{ marginTop: 0, marginBottom: 4, fontSize: 16 }}>🪄 Наполнить под профиль</h2>
            <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              Perplexity подберёт авторитетные источники под темы из <Link href="/news/profile" style={{ color: "var(--info)" }}>профиля</Link>, я авто-определю их тип (RSS / Telegram / web) и добавлю в список. Дубликаты не повторяются.
            </p>
          </div>
          <Button onClick={autoSuggest} disabled={suggesting}>
            {suggesting ? "ищу источники…" : "🪄 наполнить"}
          </Button>
        </div>
        {suggestResult && (
          <div style={{ marginTop: 12, fontSize: "var(--text-sm)", color: "var(--text)" }}>
            <b>Добавлено {suggestResult.added}</b>{suggestResult.skipped > 0 && <span style={{ color: "var(--text-muted)" }}> · пропущено {suggestResult.skipped} (дубликаты/не открылись)</span>}
            {suggestResult.topics && suggestResult.topics.length > 0 && (
              <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>
                по темам: {suggestResult.topics.join(", ")}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card padded style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Добавить источник</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", marginTop: 0, marginBottom: 12 }}>
          Просто вставь ссылку — на t.me-канал, на RSS, или на главную сайта (как bloomberg.com).
          Тип определю сам: RSS найду по `&lt;link rel=&quot;alternate&quot;&gt;`, иначе спарсю заголовки с главной.
        </p>
        <form onSubmit={submit} style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr 90px auto", alignItems: "center" }}>
          <Input
            placeholder="https://t.me/seeallochnaya  ·  bloomberg.com  ·  news.ycombinator.com/rss"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            aria-label="URL"
          />
          <Input
            placeholder="имя для UI (необязательно)"
            value={name}
            onChange={(e) => setName(e.target.value)}
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
          <Button type="submit" disabled={busy}>{busy ? "ищу…" : "Добавить"}</Button>
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
