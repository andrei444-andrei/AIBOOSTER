"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./live.module.css";

interface SessionSummary {
  id: string;
  topic: string;
  status: "active" | "finished";
  turn_count: number;
  ok_count: number;
  error_count: number;
  created_at: string;
}

export default function History() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/live-dialogue?status=all", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setErr(d.error);
        else setSessions(d.sessions ?? []);
      })
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) return <div style={{ color: "var(--danger)", fontSize: 13 }}>{err}</div>;
  if (sessions == null) return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Загружаем…</div>;
  if (sessions.length === 0)
    return (
      <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "12px 0" }}>
        Пока нет диалогов — начни первый выше.
      </div>
    );

  return (
    <div className={styles.cardGrid}>
      {sessions.map((s) => (
        <Link
          key={s.id}
          href={`/tools/english/live-dialogue/s/${s.id}`}
          style={{
            textDecoration: "none",
            color: "inherit",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: 14,
            display: "block",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
            <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{s.topic}</div>
            <span style={{ fontSize: 11, color: s.status === "finished" ? "var(--text-muted)" : "var(--info)", whiteSpace: "nowrap" }}>
              {s.status === "finished" ? "завершён" : "активен"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
            реплик {s.turn_count} · верных <span style={{ color: "var(--success)" }}>{s.ok_count}</span> · ошибок{" "}
            <span style={{ color: "var(--danger)" }}>{s.error_count}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
