"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./english.module.css";

interface JobSummary {
  id: string;
  topic: string;
  title: string | null;
  kind: "dialogue" | "monologue";
  duration_min: number;
  with_translation: number;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  stage: "script" | "tts" | "mux" | null;
  progress: number;
  audio_url: string | null;
  duration_sec: number | null;
  watch_status: "to_watch" | "watched";
  last_position_sec: number;
  created_at: string;
}

type Tab = "to_watch" | "watched" | "all";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "to_watch", label: "Слушать" },
  { id: "watched", label: "Завершённые" },
  { id: "all", label: "Все" },
];

export default function Library() {
  const [tab, setTab] = useState<Tab>("to_watch");
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fetchJobs = useCallback(async (filter: Tab) => {
    const res = await fetch(`/api/english-dialogues?limit=200&watch=${filter}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `ошибка ${res.status}`);
    return (data.jobs ?? []) as JobSummary[];
  }, []);

  // Поллим каждые 5с — пока что-то генерится, прогресс должен крутиться.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const list = await fetchJobs(tab);
        if (cancelled) return;
        setJobs(list);
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
  }, [tab, fetchJobs]);

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
                border: `1px solid ${
                  t.id === tab ? "var(--border-strong)" : "var(--border)"
                }`,
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

      {jobs == null && !err && (
        <div style={{ padding: "32px 0", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
          Загружаем…
        </div>
      )}

      {jobs && jobs.length === 0 && (
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
          {tab === "to_watch"
            ? "Пусто — сгенерируй разговор формой выше."
            : tab === "watched"
              ? "Ещё ничего не прослушано до конца."
              : "Здесь появятся сгенерированные разговоры."}
        </div>
      )}

      {jobs && jobs.length > 0 && (
        <div className={styles.cardGrid}>
          {jobs.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
        </div>
      )}
    </div>
  );
}

function JobCard({ job }: { job: JobSummary }) {
  const title = job.title || job.topic;
  const isDone = job.status === "done" && !!job.audio_url;
  const isError = job.status === "error";
  const isActive = job.status === "running" || job.status === "queued";

  const positionPct =
    isDone && job.duration_sec && job.last_position_sec > 0.5
      ? Math.min(100, (job.last_position_sec / job.duration_sec) * 100)
      : 0;

  return (
    <Link
      href={`/tools/english/dialogues/j/${job.id}`}
      style={{
        textDecoration: "none",
        color: "inherit",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        transition: "var(--transition)",
      }}
    >
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Badge>{job.kind === "monologue" ? "монолог" : "диалог"}</Badge>
          <Badge>{job.duration_min} мин</Badge>
          {job.with_translation === 1 && <Badge>с переводом</Badge>}
          {job.watch_status === "watched" && (
            <Badge color="var(--success)" bg="var(--success-bg)">
              ✓ прослушано
            </Badge>
          )}
        </div>
        <div
          style={{
            fontSize: "var(--text-base)",
            fontWeight: 600,
            lineHeight: 1.3,
            color: job.watch_status === "watched" ? "var(--text-secondary)" : "var(--text)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
          title={title}
        >
          {title}
        </div>
        {job.title && (
          <div
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--text-muted)",
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {job.topic}
          </div>
        )}

        <div style={{ marginTop: "auto", paddingTop: 4 }}>
          {isError ? (
            <StatusBadge label="ошибка" color="var(--danger)" bg="var(--danger-bg)" />
          ) : isActive ? (
            <StatusBadge
              label={`${stageLabel(job.stage)} · ${job.progress}%`}
              color="var(--info)"
              bg="var(--info-bg)"
            />
          ) : isDone ? (
            <StatusBadge
              label={job.duration_sec ? `готово · ${formatDuration(job.duration_sec)}` : "готово"}
              color="var(--success)"
              bg="var(--success-bg)"
            />
          ) : (
            <StatusBadge label={job.status} color="var(--text-muted)" bg="var(--bg-subtle)" />
          )}
        </div>
      </div>

      {positionPct > 0 && (
        <div style={{ height: 3, background: "var(--bg-subtle)" }}>
          <div style={{ width: `${positionPct}%`, height: "100%", background: "var(--accent)" }} />
        </div>
      )}
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

function StatusBadge({ label, color, bg }: { label: string; color: string; bg: string }) {
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
      {label}
    </span>
  );
}

function stageLabel(stage: JobSummary["stage"]): string {
  switch (stage) {
    case "script":
      return "пишем сценарий";
    case "tts":
      return "озвучка";
    case "mux":
      return "сборка";
    default:
      return "идёт";
  }
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec) % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
