"use client";

import { useState } from "react";
import { ENABLED_BLOCKS_META, DEFAULT_ENABLED_BLOCKS, type EnabledBlocks } from "@/lib/chat-client";

interface Settings {
  system_prompt: string;
  enabled_blocks: EnabledBlocks;
  updated_at: string;
}

const card: React.CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: 20,
  marginBottom: 20,
};
const label: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 6,
  color: "var(--text)",
};
const help: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
};
const inputBase: React.CSSProperties = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: 14,
  padding: "10px 12px",
  outline: "none",
};

export function ChatSettingsForm({ initial, token }: { initial: Settings; token: string }) {
  const [prompt, setPrompt] = useState(initial.system_prompt);
  const [blocks, setBlocks] = useState<EnabledBlocks>({ ...DEFAULT_ENABLED_BLOCKS, ...initial.enabled_blocks });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/chat-settings?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system_prompt: prompt, enabled_blocks: blocks }),
      });
      const data = await r.json();
      if (!r.ok) {
        setMsg({ kind: "err", text: data?.error?.message ?? `HTTP ${r.status}` });
      } else {
        setMsg({ kind: "ok", text: `Сохранено (${new Date(data.settings.updated_at).toLocaleString("ru-RU")})` });
      }
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const resetBlocks = () => setBlocks({ ...DEFAULT_ENABLED_BLOCKS });

  return (
    <>
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Системный промт</h2>
        <p style={{ ...help, marginTop: 0, marginBottom: 12 }}>
          Этот текст добавляется как первое system-сообщение в каждой сессии чата — перед пользовательскими.
          Сюда полезно класть «роль» ассистента, тональность, ограничения.
          Инструкции по форматированию ниже подмешиваются автоматически.
        </p>
        <label htmlFor="prompt" style={label}>Текст промта</label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={10}
          style={{ ...inputBase, fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.5, resize: "vertical" }}
        />
      </section>

      <section style={card}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Какие блоки разрешены</h2>
          <button
            type="button"
            onClick={resetBlocks}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "4px 10px",
              cursor: "pointer",
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            Сбросить
          </button>
        </div>
        <p style={{ ...help, marginTop: 0, marginBottom: 12 }}>
          Выключенный блок добавляется в системный промт со словом «НЕ используй». Модель будет стараться его избегать.
        </p>

        <div style={{ display: "grid", gap: 10 }}>
          {ENABLED_BLOCKS_META.map((meta) => (
            <label
              key={meta.key}
              style={{
                display: "grid",
                gridTemplateColumns: "20px 1fr",
                gap: 10,
                padding: 10,
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                cursor: "pointer",
                background: blocks[meta.key] ? "var(--bg-subtle)" : "var(--bg)",
              }}
            >
              <input
                type="checkbox"
                checked={blocks[meta.key]}
                onChange={(e) =>
                  setBlocks((b) => ({ ...b, [meta.key]: e.target.checked }))
                }
                style={{ marginTop: 2 }}
              />
              <div>
                <div style={{ fontWeight: 500 }}>{meta.label}</div>
                <div style={help}>{meta.description}</div>
              </div>
            </label>
          ))}
        </div>
      </section>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
        {msg && (
          <span style={{ color: msg.kind === "ok" ? "var(--success)" : "var(--danger)", fontSize: 13 }}>
            {msg.text}
          </span>
        )}
      </div>
    </>
  );
}
