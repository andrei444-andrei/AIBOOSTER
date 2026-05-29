"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, Button, Input, Textarea } from "@/components/ui";

const wrap: React.CSSProperties = {
  maxWidth: 900,
  margin: "0 auto",
  padding: "48px 32px 64px",
};

interface Topic {
  name: string;
  description?: string;
  what_bores_me?: string;
  priority?: "low" | "medium" | "high";
  status?: "active" | "muted";
}

export default function ProfilePage() {
  const [worldview, setWorldview] = useState("");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/news/profile");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setWorldview(data.profile?.worldview_context ?? "");
      setTopics(Array.isArray(data.profile?.topics) ? data.profile.topics : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaved(false);
    setError(null);
    try {
      const r = await fetch("/api/news/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worldview_context: worldview, topics }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addTopic = () => {
    setTopics([...topics, { name: "новая тема", description: "", what_bores_me: "", priority: "medium", status: "active" }]);
  };

  const updateTopic = (i: number, patch: Partial<Topic>) => {
    setTopics(topics.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  };

  const removeTopic = (i: number) => {
    setTopics(topics.filter((_, idx) => idx !== i));
  };

  const selectStyle: React.CSSProperties = {
    padding: "8px 10px",
    background: "var(--surface)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sm)",
    color: "var(--text)",
    fontSize: "var(--text-sm)",
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <main style={wrap}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24, gap: 12, flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px" }}>
            Новости · Профиль
          </p>
          <h1 style={{ fontSize: 28, lineHeight: 1.15, margin: 0 }}>Профиль интересов</h1>
        </div>
        <Link href="/news" style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", textDecoration: "none", borderBottom: "1px solid var(--border)" }}>
          ← к ленте
        </Link>
      </header>

      {error && (
        <Card padded style={{ borderColor: "var(--danger)", marginBottom: 16 }}>
          <span style={{ color: "var(--danger)" }}>Ошибка: {error}</span>
        </Card>
      )}
      {loading && <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>Загрузка…</div>}

      <Card padded style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Worldview / контекст</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginTop: 0 }}>
          1–2 абзаца: кто ты, что строишь, какие цели на 3–6 месяцев. Этот текст ложится в system-промт валидатора.
        </p>
        <Textarea
          value={worldview}
          onChange={(e) => setWorldview(e.target.value)}
          rows={6}
        />
      </Card>

      <Card padded style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Темы интересов ({topics.length})</h2>
        {topics.map((t, i) => (
          <div key={i} style={{ borderBottom: "1px solid var(--border)", padding: "16px 0", display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 110px 110px 80px", alignItems: "center" }}>
              <Input value={t.name} onChange={(e) => updateTopic(i, { name: e.target.value })} placeholder="название темы" aria-label="название темы" />
              <select value={t.priority ?? "medium"} onChange={(e) => updateTopic(i, { priority: e.target.value as Topic["priority"] })} style={selectStyle} aria-label="приоритет">
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
              <select value={t.status ?? "active"} onChange={(e) => updateTopic(i, { status: e.target.value as Topic["status"] })} style={selectStyle} aria-label="статус">
                <option value="active">active</option>
                <option value="muted">muted</option>
              </select>
              <Button variant="danger" size="sm" onClick={() => removeTopic(i)}>удалить</Button>
            </div>
            <Textarea
              placeholder="что интересно — описание для валидатора"
              value={t.description ?? ""}
              onChange={(e) => updateTopic(i, { description: e.target.value })}
              rows={2}
            />
            <Textarea
              placeholder="что НЕ интересно (опционально)"
              value={t.what_bores_me ?? ""}
              onChange={(e) => updateTopic(i, { what_bores_me: e.target.value })}
              rows={2}
            />
          </div>
        ))}
        <div style={{ marginTop: 16 }}>
          <Button variant="secondary" onClick={addTopic}>+ добавить тему</Button>
        </div>
      </Card>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Button onClick={save}>сохранить</Button>
        {saved && <span style={{ color: "var(--success)", fontSize: "var(--text-sm)" }}>сохранено ✓</span>}
      </div>
    </main>
  );
}
