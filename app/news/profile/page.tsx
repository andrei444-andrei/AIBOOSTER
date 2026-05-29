"use client";

import { useCallback, useEffect, useState } from "react";

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
  width: "100%",
  boxSizing: "border-box",
};
const btn = (primary = false): React.CSSProperties => ({
  padding: "8px 14px",
  background: primary ? "#2b6cb0" : "transparent",
  border: primary ? 0 : "1px solid #232a33",
  borderRadius: 6,
  color: primary ? "#fff" : "#a0a8b0",
  cursor: "pointer",
  fontSize: 14,
});

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

  return (
    <main style={wrap}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Профиль интересов</h1>
        <a href="/news" style={{ color: "#79b8ff", fontSize: 13 }}>← к ленте</a>
      </header>

      {error && (
        <div style={{ ...card, borderColor: "#7a2b2b" }}>Ошибка: {error}</div>
      )}
      {loading && <div style={{ opacity: 0.6 }}>Загрузка…</div>}

      <div style={card}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Worldview / контекст</h2>
        <p style={{ opacity: 0.6, fontSize: 13, marginTop: 0 }}>
          1-2 абзаца: кто ты, что строишь, какие цели на 3-6 месяцев. Этот текст ложится в system-промт валидатора.
        </p>
        <textarea
          value={worldview}
          onChange={(e) => setWorldview(e.target.value)}
          rows={6}
          style={{ ...input, fontFamily: "inherit", resize: "vertical" }}
        />
      </div>

      <div style={card}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Темы интересов ({topics.length})</h2>
        {topics.map((t, i) => (
          <div key={i} style={{ borderBottom: "1px solid #232a33", padding: "12px 0", display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 110px 110px 80px" }}>
              <input value={t.name} onChange={(e) => updateTopic(i, { name: e.target.value })} placeholder="название темы" style={input} />
              <select value={t.priority ?? "medium"} onChange={(e) => updateTopic(i, { priority: e.target.value as Topic["priority"] })} style={input}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
              <select value={t.status ?? "active"} onChange={(e) => updateTopic(i, { status: e.target.value as Topic["status"] })} style={input}>
                <option value="active">active</option>
                <option value="muted">muted</option>
              </select>
              <button onClick={() => removeTopic(i)} style={{ ...btn(), color: "#ff7b72", borderColor: "#7a2b2b" }}>удалить</button>
            </div>
            <textarea
              placeholder="что интересно — описание для валидатора"
              value={t.description ?? ""}
              onChange={(e) => updateTopic(i, { description: e.target.value })}
              rows={2}
              style={{ ...input, fontFamily: "inherit", resize: "vertical" }}
            />
            <textarea
              placeholder="что НЕ интересно (опционально)"
              value={t.what_bores_me ?? ""}
              onChange={(e) => updateTopic(i, { what_bores_me: e.target.value })}
              rows={2}
              style={{ ...input, fontFamily: "inherit", resize: "vertical" }}
            />
          </div>
        ))}
        <div style={{ marginTop: 12 }}>
          <button onClick={addTopic} style={btn()}>+ добавить тему</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button onClick={save} style={btn(true)}>сохранить</button>
        {saved && <span style={{ color: "#3fb950", fontSize: 13 }}>сохранено ✓</span>}
      </div>
    </main>
  );
}
