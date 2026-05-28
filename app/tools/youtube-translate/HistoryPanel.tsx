"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface JobSummary {
  id: string;
  yt_video_id: string;
  yt_title: string | null;
  yt_duration_sec: number | null;
  target_lang: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  stage: "download" | "asr" | "translate" | "tts" | "mux" | null;
  progress: number;
  audio_url: string | null;
  watch_status: "to_watch" | "watched";
  last_position_sec: number;
  source: "manual" | "playlist";
  created_at: string;
}

interface Props {
  /** id текущего открытого job — подсветим в списке. */
  activeId?: string;
}

export default function HistoryPanel({ activeId }: Props) {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await fetch("/api/jobs?limit=30", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setErr(data.error || `ошибка ${res.status}`);
          return;
        }
        setJobs(data.jobs ?? []);
        setErr(null);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        // Поллим раз в 5 секунд, чтобы видеть прогресс активных job'ов.
        if (!cancelled) timer = setTimeout(tick, 5000);
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <aside
      style={{
        flex: "0 0 280px",
        borderRight: "1px solid var(--border)",
        padding: "32px 20px 32px 0",
        minHeight: "calc(100vh - 64px)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 14,
          paddingLeft: 8,
        }}
      >
        История переводов
      </div>

      {jobs == null && !err && (
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: "var(--text-sm)",
            padding: "8px 8px",
          }}
        >
          Загружаем…
        </div>
      )}
      {err && (
        <div
          style={{
            color: "var(--danger)",
            fontSize: "var(--text-sm)",
            padding: "8px 8px",
          }}
        >
          {err}
        </div>
      )}
      {jobs && jobs.length === 0 && (
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: "var(--text-sm)",
            padding: "8px 8px",
          }}
        >
          Здесь появится твой первый перевод.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {jobs?.map((j) => (
          <JobItem key={j.id} job={j} active={j.id === activeId} />
        ))}
      </div>
    </aside>
  );
}

function JobItem({ job, active }: { job: JobSummary; active: boolean }) {
  const title = job.yt_title || job.yt_video_id;

  return (
    <Link
      href={`/tools/youtube-translate/j/${job.id}`}
      style={{
        textDecoration: "none",
        color: "inherit",
        display: "flex",
        gap: 10,
        padding: 8,
        borderRadius: "var(--radius-sm)",
        background: active ? "var(--bg-subtle)" : "transparent",
        border: `1px solid ${active ? "var(--border-strong)" : "transparent"}`,
        transition: "var(--transition)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://i.ytimg.com/vi/${job.yt_video_id}/default.jpg`}
        alt=""
        width={48}
        height={36}
        style={{
          borderRadius: 4,
          flexShrink: 0,
          background: "var(--bg-muted)",
          objectFit: "cover",
        }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: "var(--text-sm)",
            color:
              job.watch_status === "watched" ? "var(--text-muted)" : "var(--text)",
            lineHeight: 1.3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            marginBottom: 4,
          }}
          title={title}
        >
          {job.watch_status === "watched" && (
            <span
              style={{
                color: "var(--success)",
                marginRight: 4,
              }}
              aria-label="просмотрено"
            >
              ✓
            </span>
          )}
          {title}
        </div>
        <StatusBadge job={job} />
      </div>
    </Link>
  );
}

function StatusBadge({ job }: { job: JobSummary }) {
  let label: string;
  let color: string;
  let bg: string;

  if (job.status === "done") {
    label = `готово · ${job.target_lang}`;
    color = "var(--success)";
    bg = "var(--success-bg)";
  } else if (job.status === "error") {
    label = "ошибка";
    color = "var(--danger)";
    bg = "var(--danger-bg)";
  } else if (job.status === "running") {
    label = `${stageLabel(job.stage)} · ${job.progress}%`;
    color = "var(--info)";
    bg = "var(--info-bg)";
  } else if (job.status === "queued") {
    label = "в очереди";
    color = "var(--warning)";
    bg = "var(--warning-bg)";
  } else {
    label = job.status;
    color = "var(--text-muted)";
    bg = "var(--bg-subtle)";
  }

  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 500,
        padding: "1px 7px",
        borderRadius: 999,
        color,
        background: bg,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function stageLabel(stage: JobSummary["stage"]): string {
  switch (stage) {
    case "download":
      return "транскрипт";
    case "asr":
      return "распознаём";
    case "translate":
      return "переводим";
    case "tts":
      return "озвучка";
    case "mux":
      return "сборка";
    default:
      return "идёт";
  }
}
