"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";

interface Turn {
  idx: number;
  ai_text: string;
  user_transcript: string | null;
  verdict: "ok" | "minor" | "gross" | "skip" | null;
  error_reason: string | null;
  correction: string | null;
  created_at: string;
}
interface SessionDto {
  id: string;
  topic: string;
  status: string;
  turn_count: number;
  ok_count: number;
  error_count: number;
}

export default function SessionLog({ id }: { id: string }) {
  const [data, setData] = useState<{ session: SessionDto; turns: Turn[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/live-dialogue/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setErr(d.error);
        else setData(d);
      })
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (err) return <Card padded style={{ marginTop: 20, borderColor: "var(--danger)" }}><span style={{ color: "var(--danger)" }}>{err}</span></Card>;
  if (!data) return <div style={{ color: "var(--text-muted)", marginTop: 20 }}>Загружаем…</div>;

  const { session, turns } = data;
  return (
    <div>
      <h1 style={{ fontSize: 24, margin: "16px 0 4px" }}>{session.topic}</h1>
      <div style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 16 }}>
        реплик {session.turn_count} · верных <span style={{ color: "var(--success)" }}>{session.ok_count}</span> · ошибок{" "}
        <span style={{ color: "var(--danger)" }}>{session.error_count}</span>
      </div>

      {turns.length === 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>Ответов пока нет.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {turns.map((t, i) => {
          const gross = t.verdict === "gross";
          const skip = t.verdict === "skip";
          return (
            <Card key={i} padded style={gross ? { borderColor: "var(--danger)" } : undefined}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                AI: {t.ai_text}
              </div>
              <div style={{ fontSize: 15, color: "var(--text)" }}>
                <span style={{ color: gross ? "var(--danger)" : skip ? "var(--text-muted)" : "var(--success)", fontWeight: 600 }}>
                  {gross ? "✗" : skip ? "…" : "✓"}{" "}
                </span>
                {t.user_transcript || <em style={{ color: "var(--text-muted)" }}>—</em>}
              </div>
              {t.error_reason && (
                <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6 }}>{t.error_reason}</div>
              )}
              {t.correction && (
                <div style={{ fontSize: 13, color: "var(--text)", marginTop: 4 }}>
                  Правильно: «{t.correction}»
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
