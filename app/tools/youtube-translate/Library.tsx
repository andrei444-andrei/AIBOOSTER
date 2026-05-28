"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";

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

type Tab = "to_watch" | "watched" | "all";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "to_watch", label: "Надо смотреть" },
  { id: "watched", label: "Просмотрено" },
  { id: "all", label: "Все" },
];

export default function Library() {
  const [tab, setTab] = useState<Tab>("to_watch");
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [playlistInput, setPlaylistInput] = useState("");
  const [playlistSaved, setPlaylistSaved] = useState<string | null>(null);
  const [playlistSaving, setPlaylistSaving] = useState(false);
  const [playlistMsg, setPlaylistMsg] = useState<string | null>(null);

  // Подтягиваем сохранённый playlist_id при первом маунте.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/playlist/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.playlist_id) {
          setPlaylistSaved(data.playlist_id);
          setPlaylistInput(data.playlist_id);
        }
      })
      .catch(() => {
        // тихо: фича опциональная, без неё библиотека всё равно работает
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchJobs = useCallback(async (filter: Tab) => {
    const watch = filter === "all" ? "all" : filter;
    const res = await fetch(`/api/jobs?limit=200&watch=${watch}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `ошибка ${res.status}`);
    return (data.jobs ?? []) as JobSummary[];
  }, []);

  // Поллим каждые 5с пока есть активные job'ы — чтобы прогресс крутился.
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

  async function savePlaylist(e: React.FormEvent) {
    e.preventDefault();
    setPlaylistSaving(true);
    setPlaylistMsg(null);
    try {
      const res = await fetch("/api/playlist/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playlist_id: playlistInput || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPlaylistMsg(data.error || `ошибка ${res.status}`);
      } else {
        setPlaylistSaved(data.playlist_id);
        setPlaylistInput(data.playlist_id ?? "");
        setPlaylistMsg(
          data.playlist_id
            ? "сохранено — следующий cron-тик подтянет видео"
            : "плейлист отключён",
        );
        setTimeout(() => setPlaylistMsg(null), 4000);
      }
    } catch (e) {
      setPlaylistMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setPlaylistSaving(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const res = await fetch("/api/playlist/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setRefreshMsg(data.error || `ошибка ${res.status}`);
      } else {
        const queued = data.queued?.length ?? 0;
        setRefreshMsg(
          queued > 0
            ? `добавлено в очередь: ${queued}`
            : `новых видео нет (в плейлисте ${data.totalInFeed ?? 0}, у нас уже ${data.alreadyHave ?? 0})`,
        );
        // Сразу перечитываем список — новые job'ы должны появиться.
        try {
          const list = await fetchJobs(tab);
          setJobs(list);
        } catch {
          // не критично — следующий поллер-тик подтянет
        }
      }
    } catch (e) {
      setRefreshMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
      // Сообщение об успехе скрываем через 4 секунды.
      setTimeout(() => setRefreshMsg(null), 4000);
    }
  }

  return (
    <div>
      <form
        onSubmit={savePlaylist}
        style={{
          marginBottom: 20,
          padding: 14,
          background: "var(--bg-subtle)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
      >
        <div
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
            marginBottom: 8,
          }}
        >
          ID или URL публичного YouTube-плейлиста
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 280px", minWidth: 0 }}>
            <Input
              type="text"
              placeholder="PLxyz... или https://www.youtube.com/playlist?list=PLxyz..."
              value={playlistInput}
              onChange={(e) => setPlaylistInput(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Button type="submit" variant="primary" loading={playlistSaving}>
            Сохранить
          </Button>
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: "var(--text-sm)",
            color: playlistMsg ? "var(--text)" : "var(--text-muted)",
          }}
        >
          {playlistMsg
            ? playlistMsg
            : playlistSaved
              ? `активен: ${playlistSaved}`
              : "не задан — автоочередь не работает, можно вставлять ссылки руками"}
        </div>
      </form>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 4 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                padding: "8px 14px",
                background:
                  t.id === tab ? "var(--bg-subtle)" : "transparent",
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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {refreshMsg && (
            <span
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--text-muted)",
              }}
            >
              {refreshMsg}
            </span>
          )}
          <Button
            variant="secondary"
            onClick={refresh}
            loading={refreshing}
          >
            ↻ Обновить плейлист
          </Button>
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
        <div
          style={{
            padding: "32px 0",
            color: "var(--text-muted)",
            fontSize: "var(--text-sm)",
          }}
        >
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
            ? "Пусто — добавь видео в плейлист или вставь ссылку выше."
            : tab === "watched"
              ? "Ещё ничего не прослушано."
              : "Здесь появятся переводы."}
        </div>
      )}

      {jobs && jobs.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {jobs.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
        </div>
      )}
    </div>
  );
}

function JobCard({ job }: { job: JobSummary }) {
  const title = job.yt_title || job.yt_video_id;
  const isDone = job.status === "done" && !!job.audio_url;
  const isError = job.status === "error";
  const isActive = job.status === "running" || job.status === "queued";

  const positionPct =
    isDone && job.yt_duration_sec && job.last_position_sec > 0.5
      ? Math.min(100, (job.last_position_sec / job.yt_duration_sec) * 100)
      : 0;

  return (
    <Link
      href={`/tools/youtube-translate/j/${job.id}`}
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
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16/9",
          background: "var(--bg-subtle)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://i.ytimg.com/vi/${job.yt_video_id}/mqdefault.jpg`}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
        {/* Watch-status / source overlay */}
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            display: "flex",
            gap: 6,
          }}
        >
          {job.source === "playlist" && (
            <Badge color="var(--text-muted)" bg="rgba(0,0,0,0.55)">
              из плейлиста
            </Badge>
          )}
          {job.watch_status === "watched" && (
            <Badge color="#fff" bg="rgba(34, 139, 34, 0.85)">
              ✓ просмотрено
            </Badge>
          )}
        </div>
        {isDone && job.yt_duration_sec && (
          <div
            style={{
              position: "absolute",
              right: 8,
              bottom: 8,
              padding: "2px 6px",
              background: "rgba(0,0,0,0.7)",
              color: "#fff",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              borderRadius: 3,
            }}
          >
            {formatDuration(job.yt_duration_sec)}
          </div>
        )}
        {positionPct > 0 && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 3,
              background: "rgba(0,0,0,0.35)",
            }}
          >
            <div
              style={{
                width: `${positionPct}%`,
                height: "100%",
                background: "var(--accent)",
              }}
            />
          </div>
        )}
      </div>
      <div style={{ padding: 12 }}>
        <div
          style={{
            fontSize: "var(--text-base)",
            lineHeight: 1.3,
            color: "var(--text)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            marginBottom: 8,
            minHeight: 38,
          }}
          title={title}
        >
          {title}
        </div>
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
            label={`готово · ${job.target_lang}`}
            color="var(--success)"
            bg="var(--success-bg)"
          />
        ) : (
          <StatusBadge label={job.status} color="var(--text-muted)" bg="var(--bg-subtle)" />
        )}
      </div>
    </Link>
  );
}

function Badge({
  children,
  color,
  bg,
}: {
  children: React.ReactNode;
  color: string;
  bg: string;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 7px",
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

function StatusBadge({
  label,
  color,
  bg,
}: {
  label: string;
  color: string;
  bg: string;
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

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec) % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
