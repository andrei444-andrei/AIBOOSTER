"use client";

import { useState } from "react";
import {
  MODEL_OPTIONS,
  CATEGORY_META,
  REASONING_EFFORTS,
  type CategoryRoute,
  type ReasoningEffort,
} from "@/lib/chat-client";

const card: React.CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: 20,
  marginBottom: 20,
};
const help: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)" };
const inputBase: React.CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: 13,
  padding: "6px 8px",
  outline: "none",
  height: 32,
};

export function RoutingForm({ initial, token }: { initial: CategoryRoute[]; token: string }) {
  const [routes, setRoutes] = useState<CategoryRoute[]>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const update = (idx: number, patch: Partial<CategoryRoute>) => {
    setRoutes((arr) => arr.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/chat-routing?token=${encodeURIComponent(token)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routes }),
      });
      const data = await r.json();
      if (!r.ok) {
        setMsg({ kind: "err", text: data?.error?.message ?? `HTTP ${r.status}` });
      } else {
        setRoutes(data.routes);
        setMsg({ kind: "ok", text: `Сохранено (${new Date().toLocaleString("ru-RU")})` });
      }
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section style={card}>
      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 140px 110px", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <div style={{ ...help, fontWeight: 500 }}>Категория</div>
        <div style={{ ...help, fontWeight: 500 }}>Модель</div>
        <div style={{ ...help, fontWeight: 500 }}>reasoning_effort</div>
        <div style={{ ...help, fontWeight: 500 }}>max_tokens</div>
      </div>
      {routes.map((r, idx) => {
        const meta = CATEGORY_META[r.category];
        const modelOpt = MODEL_OPTIONS.find((m) => m.id === r.model);
        const reasoningSupported = !!modelOpt?.reasoning;
        return (
          <div
            key={r.category}
            style={{ display: "grid", gridTemplateColumns: "180px 1fr 140px 110px", gap: 8, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border)" }}
          >
            <div>
              <div style={{ fontWeight: 500 }}>{meta.icon} {meta.label}</div>
              <div style={help}>{meta.hint}</div>
            </div>
            <select
              value={r.model}
              onChange={(e) => update(idx, { model: e.target.value })}
              style={{ ...inputBase, width: "100%" }}
            >
              {Array.from(new Set(MODEL_OPTIONS.map((m) => m.vendor))).map((vendor) => (
                <optgroup key={vendor} label={vendor}>
                  {MODEL_OPTIONS.filter((m) => m.vendor === vendor).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                      {m.reasoning ? " · reasoning" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select
              value={r.reasoning_effort ?? ""}
              onChange={(e) =>
                update(idx, {
                  reasoning_effort: (e.target.value || null) as ReasoningEffort | null,
                })
              }
              disabled={!reasoningSupported}
              style={{ ...inputBase, width: "100%", opacity: reasoningSupported ? 1 : 0.5 }}
              title={reasoningSupported ? "" : "Модель не поддерживает reasoning_effort"}
            >
              <option value="">— нет —</option>
              {REASONING_EFFORTS.map((re) => (
                <option key={re} value={re}>{re}</option>
              ))}
            </select>
            <input
              type="number"
              min={500}
              max={32000}
              step={500}
              value={r.max_tokens}
              onChange={(e) => update(idx, { max_tokens: Number(e.target.value) || 4000 })}
              style={{ ...inputBase, width: "100%", textAlign: "right" }}
            />
          </div>
        );
      })}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{
            background: "var(--accent)",
            color: "var(--text-on-accent)",
            border: "1px solid var(--accent)",
            borderRadius: "var(--radius)",
            padding: "0 20px",
            height: 38,
            cursor: saving ? "wait" : "pointer",
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 500,
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "Сохраняем…" : "Сохранить маршруты"}
        </button>
        {msg && (
          <span style={{ color: msg.kind === "ok" ? "var(--success, var(--accent))" : "var(--danger)", fontSize: 13 }}>
            {msg.text}
          </span>
        )}
      </div>
    </section>
  );
}
