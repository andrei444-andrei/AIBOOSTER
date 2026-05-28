"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";

type Stage = "download" | "asr" | "translate" | "tts" | "mux" | null;
type Status = "queued" | "running" | "done" | "error" | "cancelled";
type WatchStatus = "to_watch" | "watched";

interface Chapter {
  start_sec: number;
  title: string;
}

interface JobDto {
  id: string;
  url: string;
  video_id: string;
  title: string | null;
  duration_sec: number | null;
  source_lang: string | null;
  target_lang: string;
  quality: string;
  status: Status;
  stage: Stage;
  progress: number;
  error_message: string | null;
  error_id: string | null;
  audio_url: string | null;
  watch_status: WatchStatus;
  last_position_sec: number;
  source: string;
  summary: string | null;
  chapters: Chapter[];
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface SegmentDto {
  idx: number;
  start_ms: number;
  end_ms: number;
  source_text: string | null;
  translated_text: string | null;
}

interface ApiResponse {
  job: JobDto;
  segments: SegmentDto[];
}

const STAGE_LABEL: Record<Exclude<Stage, null>, string> = {
  download: "Тянем транскрипт с YouTube",
  asr: "Распознаём речь",
  translate: "Переводим текст",
  tts: "Озвучиваем",
  mux: "Собираем итоговый трек",
};
const STAGE_ORDER: Exclude<Stage, null>[] = ["download", "asr", "translate", "tts", "mux"];

export default function JobView({ jobId }: { jobId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Поллинг: каждые 2 сек, пока статус queued/running.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) setFetchError(body.error || `ошибка ${res.status}`);
          return;
        }
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        setData(json);
        setFetchError(null);
        if (json.job.status === "queued" || json.job.status === "running") {
          timer = setTimeout(tick, 2000);
        }
      } catch (err) {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : String(err));
        timer = setTimeout(tick, 4000);
      }
    }
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  if (!data && !fetchError) {
    return (
      <Card padded style={{ marginTop: 24 }}>
        <span style={{ color: "var(--text-secondary)" }}>Загружаем задачу…</span>
      </Card>
    );
  }
  if (fetchError && !data) {
    return (
      <Card
        padded
        style={{
          marginTop: 24,
          borderColor: "var(--danger)",
          background: "var(--danger-bg)",
        }}
      >
        <span style={{ color: "var(--danger)" }}>
          Не удалось загрузить задачу: {fetchError}
        </span>
      </Card>
    );
  }
  if (!data) return null;

  const { job, segments } = data;

  return (
    <div>
      <Hero job={job} />

      {(job.status === "queued" || job.status === "running") && (
        <ProgressCard job={job} />
      )}

      {job.status === "error" && (
        <Card
          padded
          style={{
            marginTop: 20,
            borderColor: "var(--danger)",
            background: "var(--danger-bg)",
          }}
        >
          <div
            style={{
              color: "var(--danger)",
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Что-то пошло не так
          </div>
          <div style={{ fontSize: "var(--text-base)", color: "var(--text)" }}>
            {job.error_message || "неизвестная ошибка"}
          </div>
          {job.error_id && (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              error_id:{" "}
              <code style={{ fontFamily: "var(--font-mono)" }}>{job.error_id}</code>
            </div>
          )}
          <Link href="/tools/youtube-translate" style={{ display: "inline-block", marginTop: 14 }}>
            <Button variant="primary">Попробовать снова</Button>
          </Link>
        </Card>
      )}

      {job.status === "done" && job.audio_url && (
        <ResultCard job={job} segments={segments} />
      )}
    </div>
  );
}

function Hero({ job }: { job: JobDto }) {
  return (
    <Card
      padded
      style={{
        marginTop: 20,
        display: "grid",
        gridTemplateColumns: "minmax(0, 200px) 1fr",
        gap: 20,
      }}
    >
      <a
        href={`https://youtu.be/${job.video_id}`}
        target="_blank"
        rel="noopener"
        style={{
          display: "block",
          aspectRatio: "16/9",
          background: "var(--bg-subtle)",
          borderRadius: "var(--radius-sm)",
          overflow: "hidden",
          textDecoration: "none",
          alignSelf: "start",
        }}
        title="Открыть оригинал на YouTube"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://i.ytimg.com/vi/${job.video_id}/mqdefault.jpg`}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      </a>
      <div style={{ minWidth: 0 }}>
        <h1
          style={{
            fontSize: 22,
            lineHeight: 1.25,
            letterSpacing: "-0.01em",
            margin: 0,
            marginBottom: 6,
          }}
        >
          {job.title || "Перевод видео"}
        </h1>
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: "var(--text-sm)",
            marginBottom: job.summary ? 12 : 0,
          }}
        >
          <strong style={{ color: "var(--text-secondary)" }}>
            {job.target_lang.toUpperCase()}
          </strong>
          {job.source_lang ? ` ← ${job.source_lang.toUpperCase()}` : ""}
          {job.duration_sec ? ` · ${formatDuration(job.duration_sec)}` : ""}
          {" · "}
          <a
            href={`https://youtu.be/${job.video_id}`}
            target="_blank"
            rel="noopener"
            style={{
              color: "var(--text-secondary)",
              textDecoration: "none",
              borderBottom: "1px solid var(--border)",
            }}
          >
            оригинал ↗
          </a>
        </div>
        {job.summary && (
          <p
            style={{
              margin: 0,
              fontSize: "var(--text-base)",
              lineHeight: "var(--leading-relaxed)",
              color: "var(--text)",
            }}
          >
            {job.summary}
          </p>
        )}
      </div>
    </Card>
  );
}

function ProgressCard({ job }: { job: JobDto }) {
  const currentIdx = job.stage ? STAGE_ORDER.indexOf(job.stage) : -1;
  return (
    <Card padded style={{ marginTop: 20 }}>
      <div
        style={{
          marginBottom: 12,
          fontSize: "var(--text-base)",
          color: "var(--text-secondary)",
        }}
      >
        {job.status === "queued"
          ? "В очереди — скоро возьмём в работу"
          : "Обрабатываем"}
        {" · "}
        <strong style={{ color: "var(--text)" }}>{job.progress}%</strong>
      </div>
      <div
        style={{
          height: 6,
          background: "var(--bg-subtle)",
          borderRadius: 3,
          overflow: "hidden",
          marginBottom: 18,
        }}
      >
        <div
          style={{
            width: `${job.progress}%`,
            height: "100%",
            background: "var(--accent)",
            transition: "width 400ms var(--ease)",
          }}
        />
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {STAGE_ORDER.map((s, i) => {
          const done = currentIdx > i || job.status === "done";
          const active = currentIdx === i && job.status === "running";
          const muted = !done && !active;
          return (
            <div
              key={s}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                color: muted ? "var(--text-muted)" : "var(--text)",
              }}
            >
              <span
                style={{
                  width: 16,
                  textAlign: "center",
                  color: done
                    ? "var(--success)"
                    : active
                      ? "var(--info)"
                      : "var(--text-muted)",
                }}
              >
                {done ? "✓" : active ? "▣" : "·"}
              </span>
              <span style={{ fontSize: "var(--text-base)" }}>{STAGE_LABEL[s]}</span>
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 18,
          fontSize: 12,
          color: "var(--text-muted)",
        }}
      >
        Можно закрыть вкладку — вернись по этой же ссылке, прогресс не потеряется.
      </div>
    </Card>
  );
}

function ResultCard({ job, segments }: { job: JobDto; segments: SegmentDto[] }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);
  const [watchStatus, setWatchStatus] = useState<WatchStatus>(job.watch_status);
  const lastSavedRef = useRef<number>(job.last_position_sec);

  // Прыгаем на сохранённую позицию когда аудио готов читать. Делаем один раз
  // на маунт. Если уже отметили watched и резюм=0, никуда не прыгаем.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    let seeded = false;
    const target = job.last_position_sec;
    function seedPosition() {
      if (seeded) return;
      seeded = true;
      if (a && target > 0.5 && a.duration && target < a.duration - 1) {
        try {
          a.currentTime = target;
        } catch {
          // ignore — некоторые браузеры не любят currentTime до loadedmetadata
        }
      }
    }
    a.addEventListener("loadedmetadata", seedPosition);
    return () => a.removeEventListener("loadedmetadata", seedPosition);
  }, [job.last_position_sec]);

  // Слушаем timeupdate для подсветки активного сегмента + периодически
  // сохраняем позицию в БД (раз в 5 сек, чтобы не спамить).
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      const ms = Math.round(a.currentTime * 1000);
      setCurrentMs(ms);
      const sec = a.currentTime;
      if (Math.abs(sec - lastSavedRef.current) >= 5) {
        lastSavedRef.current = sec;
        void savePlayback(job.id, { last_position_sec: sec });
      }
    };
    const onPause = () => {
      lastSavedRef.current = a.currentTime;
      void savePlayback(job.id, { last_position_sec: a.currentTime });
    };
    const onEnded = () => {
      lastSavedRef.current = 0;
      setWatchStatus("watched");
      void savePlayback(job.id, {
        last_position_sec: 0,
        watch_status: "watched",
      });
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
    };
  }, [job.id]);

  // На beforeunload сохраняем позицию через sendBeacon (обычный fetch не
  // успевает завершиться при закрытии вкладки).
  useEffect(() => {
    function flush() {
      const a = audioRef.current;
      if (!a) return;
      // fetch с keepalive — браузер довезёт запрос даже если страница уже
      // закрывается. sendBeacon не умеет PATCH-методы, поэтому остаёмся на
      // fetch с указанным флагом — он специально для этого сценария.
      try {
        void fetch(`/api/jobs/${job.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ last_position_sec: a.currentTime }),
          keepalive: true,
        });
      } catch {
        // ignore
      }
    }
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [job.id]);

  const activeIdx = segments.findIndex(
    (s) => currentMs >= s.start_ms && currentMs < s.end_ms,
  );

  function seekTo(ms: number) {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = ms / 1000;
    a.play().catch(() => {});
  }

  async function toggleWatched() {
    const next: WatchStatus = watchStatus === "watched" ? "to_watch" : "watched";
    setWatchStatus(next);
    await savePlayback(job.id, { watch_status: next });
  }

  return (
    <>
      <Card padded style={{ marginTop: 20 }}>
        <audio
          ref={audioRef}
          src={job.audio_url ?? undefined}
          controls
          preload="metadata"
          style={{ width: "100%" }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={toggleWatched}
            style={{
              padding: "6px 12px",
              background:
                watchStatus === "watched" ? "var(--success-bg)" : "var(--bg-subtle)",
              border: `1px solid ${
                watchStatus === "watched" ? "var(--success)" : "var(--border)"
              }`,
              borderRadius: "var(--radius-sm)",
              color:
                watchStatus === "watched" ? "var(--success)" : "var(--text)",
              fontSize: "var(--text-sm)",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {watchStatus === "watched"
              ? "✓ Просмотрено"
              : "Отметить как просмотрено"}
          </button>
          <a
            href={job.audio_url ?? "#"}
            download
            style={{
              padding: "6px 12px",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text)",
              textDecoration: "none",
              fontSize: "var(--text-sm)",
            }}
          >
            ↓ Скачать mp3
          </a>
          <a
            href={`https://youtu.be/${job.video_id}`}
            target="_blank"
            rel="noopener"
            style={{
              padding: "6px 12px",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text)",
              textDecoration: "none",
              fontSize: "var(--text-sm)",
            }}
          >
            Оригинал на YouTube ↗
          </a>
          {segments.length > 0 && segments.some((s) => s.source_text) && (
            <label
              style={{
                padding: "6px 12px",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text)",
                fontSize: "var(--text-sm)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <input
                type="checkbox"
                checked={showOriginal}
                onChange={(e) => setShowOriginal(e.target.checked)}
                style={{ margin: 0 }}
              />
              показывать оригинал
            </label>
          )}
        </div>
      </Card>

      {job.chapters && job.chapters.length > 0 && (
        <Card padded style={{ marginTop: 20 }}>
          <div
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--text-muted)",
              marginBottom: 10,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Главы
          </div>
          <div style={{ display: "grid", gap: 2 }}>
            {job.chapters.map((ch, i) => {
              const next = job.chapters[i + 1];
              const currentSec = currentMs / 1000;
              const active =
                currentSec >= ch.start_sec &&
                (next ? currentSec < next.start_sec : true);
              return (
                <button
                  key={`${ch.start_sec}-${i}`}
                  onClick={() => seekTo(ch.start_sec * 1000)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "56px 1fr",
                    gap: 12,
                    textAlign: "left",
                    background: active ? "var(--bg-subtle)" : "transparent",
                    border: `1px solid ${active ? "var(--border-strong)" : "transparent"}`,
                    borderRadius: "var(--radius-sm)",
                    padding: "8px 10px",
                    color: active ? "var(--text)" : "var(--text)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: "var(--text-base)",
                    lineHeight: 1.35,
                    transition: "var(--transition)",
                  }}
                >
                  <span
                    style={{
                      color: "var(--text-muted)",
                      fontVariantNumeric: "tabular-nums",
                      fontSize: 12,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {formatTimecode(ch.start_sec * 1000)}
                  </span>
                  <span style={{ fontWeight: active ? 600 : 500 }}>{ch.title}</span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {segments.length > 0 && (
        <Card padded style={{ marginTop: 20 }}>
          <div
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--text-muted)",
              marginBottom: 10,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Транскрипт ({job.target_lang.toUpperCase()})
            {showOriginal && job.source_lang
              ? ` ← ${job.source_lang.toUpperCase()}`
              : ""}
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            {segments.map((s, i) => {
              const active = i === activeIdx;
              return (
                <button
                  key={s.idx}
                  onClick={() => seekTo(s.start_ms)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "56px 1fr",
                    gap: 12,
                    textAlign: "left",
                    background: active ? "var(--bg-subtle)" : "transparent",
                    border: `1px solid ${active ? "var(--border-strong)" : "transparent"}`,
                    borderRadius: "var(--radius-sm)",
                    padding: "8px 10px",
                    color: "var(--text)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: "var(--text-base)",
                    lineHeight: "var(--leading-normal)",
                    transition: "var(--transition)",
                  }}
                >
                  <span
                    style={{
                      color: "var(--text-muted)",
                      fontVariantNumeric: "tabular-nums",
                      fontSize: 12,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {formatTimecode(s.start_ms)}
                  </span>
                  <span>
                    <div>
                      {s.translated_text || (
                        <em style={{ color: "var(--text-muted)" }}>—</em>
                      )}
                    </div>
                    {showOriginal && s.source_text && (
                      <div
                        style={{
                          color: "var(--text-muted)",
                          fontSize: "var(--text-sm)",
                          marginTop: 2,
                        }}
                      >
                        {s.source_text}
                      </div>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}
    </>
  );
}

function formatTimecode(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

async function savePlayback(
  jobId: string,
  body: { last_position_sec?: number; watch_status?: WatchStatus },
): Promise<void> {
  try {
    await fetch(`/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    // не критично — позиция сохранится на следующем тике/событии
  }
}
