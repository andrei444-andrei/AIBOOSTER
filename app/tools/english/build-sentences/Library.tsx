"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./build.module.css";

interface TaskSummary {
  id: string;
  topic: string;
  title: string | null;
  status: "generating" | "ready" | "failed";
  total: number;
  done: number;
  completed_count: number;
  created_at: string;
}

type Tab = "todo" | "done" | "all";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "todo", label: "Надо сделать" },
  { id: "done", label: "Сделано" },
  { id: "all", label: "Все" },
];

export default function Library() {
  const [tab, setTab] = useState<Tab>("todo");
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fetchTasks = useCallback(async (section: Tab) => {
    const res = await fetch(`/api/english-sentences?section=${section}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `ошибка ${res.status}`);
    return (data.tasks ?? []) as TaskSummary[];
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const list = await fetchTasks(tab);
        if (cancelled) return;
        setTasks(list);
        setErr(null);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) timer = setTimeout(tick, 5000);
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [tab, fetchTasks]);

  return (
    <div>
      <div className={styles.tabsRow}>
        <div className={styles.tabs}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                padding: "8px 14px",
                background: t.id === tab ? "var(--bg-subtle)" : "transparent",
                border: `1px solid ${t.id === tab ? "var(--border-strong)" : "var(--border)"}`,
                borderRadius: "var(--radius-sm)",
                color: t.id === tab ? "var(--text)" : "var(--text-secondary)",
                fontSize: "var(--text-sm)",
                fontWeight: t.id === tab ? 600 : 500,
                fontFamily: "inherit",
                cursor: "pointer",
                transition: "var(--transition)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div
          style={{
            padding: 12,
            background: "var(--danger-bg)",
            border: "1px solid var(--danger)",
            color: "var(--danger)",
            borderRadius: "var(--radius-sm)",
            marginBottom: 12,
            fontSize: "var(--text-sm)",
          }}
        >
          {err}
        </div>
      )}

      {tasks == null && !err && (
        <div style={{ padding: "32px 0", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
          Загружаем…
        </div>
      )}

      {tasks && tasks.length === 0 && (
        <div
          style={{
            padding: "40px 16px",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            color: "var(--text-muted)",
            fontSize: "var(--text-sm)",
            textAlign: "center",
          }}
        >
          {tab === "todo"
            ? "Пусто — сгенерируй задание формой выше."
            : tab === "done"
              ? "Ещё ничего не выполнено до конца."
              : "Здесь появятся задания."}
        </div>
      )}

      {tasks && tasks.length > 0 && (
        <div className={styles.cardGrid}>
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task }: { task: TaskSummary }) {
  const title = task.title || task.topic;
  const pct = task.total > 0 ? Math.round((task.completed_count / task.total) * 100) : 0;
  return (
    <Link
      href={`/tools/english/build-sentences/t/${task.id}`}
      style={{
        textDecoration: "none",
        color: "inherit",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Badge>{task.total || "—"} предложений</Badge>
          {task.done === 1 && (
            <Badge color="var(--success)" bg="var(--success-bg)">
              ✓ готово
            </Badge>
          )}
          {task.status === "generating" && (
            <Badge color="var(--info)" bg="var(--info-bg)">
              генерируется…
            </Badge>
          )}
          {task.status === "failed" && (
            <Badge color="var(--danger)" bg="var(--danger-bg)">
              ошибка
            </Badge>
          )}
        </div>
        <div
          style={{
            fontSize: "var(--text-base)",
            fontWeight: 600,
            lineHeight: 1.3,
            color: task.done === 1 ? "var(--text-secondary)" : "var(--text)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
          title={title}
        >
          {title}
        </div>
        <div style={{ marginTop: "auto" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
            собрано {task.completed_count}/{task.total || "—"}
          </div>
          <div style={{ height: 4, background: "var(--bg-subtle)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
          </div>
        </div>
      </div>
    </Link>
  );
}

function Badge({
  children,
  color = "var(--text-secondary)",
  bg = "var(--bg-subtle)",
}: {
  children: React.ReactNode;
  color?: string;
  bg?: string;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 500,
        color,
        background: bg,
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
