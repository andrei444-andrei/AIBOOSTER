"use client";

import { useState } from "react";
import { Button, Card, Input, Textarea } from "@/components/ui";

// Форма запуска прогона. Шлёт POST /api/research/start с admin-токеном в заголовке
// и переходит на страницу прогона. Токен прокидывается со страницы (паттерн /admin).
export default function StartForm({ token }: { token: string }) {
  const [goal, setGoal] = useState("");
  const [fanout, setFanout] = useState(8);
  const [maxNodes, setMaxNodes] = useState(24);
  const [maxDepth, setMaxDepth] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    const g = goal.trim();
    if (!g || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/research/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ goal: g, params: { fanout, maxNodes, maxDepth } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      window.location.href = `/research/${data.id}?token=${encodeURIComponent(token)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 style={{ fontSize: "var(--text-lg)", marginTop: 0, marginBottom: 12 }}>Новый прогон</h2>
      <Textarea
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="Например: какие факторы влияют на доходность на фондовом рынке?"
        rows={3}
      />
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
        <div style={{ width: 150 }}>
          <Input
            type="number"
            label="Ширина (под-вопросов)"
            value={fanout}
            min={1}
            max={16}
            onChange={(e) => setFanout(clampNum(e.target.value, 1, 16))}
          />
        </div>
        <div style={{ width: 150 }}>
          <Input
            type="number"
            label="Потолок узлов"
            value={maxNodes}
            min={1}
            max={200}
            onChange={(e) => setMaxNodes(clampNum(e.target.value, 1, 200))}
          />
        </div>
        <div style={{ width: 150 }}>
          <Input
            type="number"
            label="Глубина дерева"
            value={maxDepth}
            min={0}
            max={4}
            onChange={(e) => setMaxDepth(clampNum(e.target.value, 0, 4))}
          />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
        <Button onClick={start} loading={busy} disabled={!goal.trim()}>
          Запустить исследование
        </Button>
        <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
          глубина 1 = плоский MVP (корень → под-вопросы); &gt;1 включает дерево с backtracking
        </span>
      </div>
      {error && (
        <p style={{ color: "var(--danger)", marginTop: 12, fontSize: "var(--text-sm)" }}>{error}</p>
      )}
    </Card>
  );
}

function clampNum(v: string, lo: number, hi: number): number {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(n, lo), hi);
}
