"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import ytStyles from "../../youtube.module.css";

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
    <Card padded style={{ marginTop: 20 }} className={ytStyles.hero}>
      <a
        href={`https://youtu.be/${job.video_id}`}
        target="_blank"
        rel="noopener"
        className={ytStyles.heroThumb}
        title="Открыть оригинал на YouTube"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`https://i.ytimg.com/vi/${job.video_id}/mqdefault.jpg`} alt="" />
      </a>
      <div style={{ minWidth: 0 }}>
        <h1 className={ytStyles.heroTitle}>{job.title || "Перевод видео"}</h1>
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
          style={{ width: "100%", borderRadius: "var(--radius-sm)" }}
        />
        <div className={ytStyles.actionsRow}>
          <Button
            size="sm"
            variant={watchStatus === "watched" ? "secondary" : "primary"}
            onClick={toggleWatched}
            leadingIcon={watchStatus === "watched" ? <span>✓</span> : null}
          >
            {watchStatus === "watched" ? "Просмотрено" : "Отметить просмотренным"}
          </Button>
          <LinkChip href={job.audio_url ?? "#"} download leading="↓">
            mp3
          </LinkChip>
          <LinkChip
            href={`https://youtu.be/${job.video_id}`}
            target="_blank"
            rel="noopener"
            trailing="↗"
          >
            Оригинал
          </LinkChip>
          {segments.length > 0 && segments.some((s) => s.source_text) && (
            <label
              className={ytStyles.toggleOriginal}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-2)",
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={showOriginal}
                onChange={(e) => setShowOriginal(e.target.checked)}
                style={{
                  margin: 0,
                  accentColor: "var(--accent)",
                  width: 14,
                  height: 14,
                }}
              />
              оригинал в транскрипте
            </label>
          )}
        </div>
      </Card>

      {job.chapters && job.chapters.length > 0 && (
        <Card padded style={{ marginTop: 20 }}>
          <SectionLabel>Главы</SectionLabel>
          <NavList>
            {job.chapters.map((ch, i) => {
              const next = job.chapters[i + 1];
              const currentSec = currentMs / 1000;
              const active =
                currentSec >= ch.start_sec &&
                (next ? currentSec < next.start_sec : true);
              return (
                <NavRow
                  key={`${ch.start_sec}-${i}`}
                  active={active}
                  onClick={() => seekTo(ch.start_sec * 1000)}
                  timecode={formatTimecode(ch.start_sec * 1000)}
                >
                  <span style={{ fontWeight: active ? 600 : 500 }}>{ch.title}</span>
                </NavRow>
              );
            })}
          </NavList>
        </Card>
      )}

      {segments.length > 0 && (
        <Card padded style={{ marginTop: 20 }}>
          <SectionLabel>
            Транскрипт ({job.target_lang.toUpperCase()})
            {showOriginal && job.source_lang
              ? ` ← ${job.source_lang.toUpperCase()}`
              : ""}
          </SectionLabel>
          <NavList>
            {segments.map((s, i) => {
              const active = i === activeIdx;
              return (
                <NavRow
                  key={s.idx}
                  active={active}
                  onClick={() => seekTo(s.start_ms)}
                  timecode={formatTimecode(s.start_ms)}
                >
                  <div
                    style={{
                      lineHeight: "var(--leading-normal)",
                      whiteSpace: "pre-line",
                    }}
                  >
                    {s.translated_text || (
                      <em style={{ color: "var(--text-muted)" }}>—</em>
                    )}
                  </div>
                  {showOriginal && s.source_text && (
                    <div
                      style={{
                        color: "var(--text-muted)",
                        fontSize: "var(--text-sm)",
                        marginTop: 4,
                        lineHeight: "var(--leading-normal)",
                      }}
                    >
                      {s.source_text}
                    </div>
                  )}
                </NavRow>
              );
            })}
          </NavList>
        </Card>
      )}
    </>
  );
}

// Ссылка-чип в визуальном стиле ghost-кнопки из UX Kit. Button не
// поддерживает as="a", поэтому делаем локальный аналог под анкеры
// (загрузка mp3, открытие YouTube).
function LinkChip({
  href,
  children,
  leading,
  trailing,
  download,
  target,
  rel,
}: {
  href: string;
  children: React.ReactNode;
  leading?: string;
  trailing?: string;
  download?: boolean;
  target?: string;
  rel?: string;
}) {
  return (
    <a
      href={href}
      target={target}
      rel={rel}
      {...(download ? { download: "" } : {})}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        height: 28,
        padding: "0 var(--space-3)",
        background: "transparent",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        color: "var(--text)",
        textDecoration: "none",
        fontSize: "var(--text-sm)",
        fontWeight: 500,
        transition: "var(--transition)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-subtle)";
        e.currentTarget.style.borderColor = "var(--border-strong)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      {leading && <span aria-hidden>{leading}</span>}
      <span>{children}</span>
      {trailing && <span aria-hidden>{trailing}</span>}
    </a>
  );
}

// Eyebrow-стиль заголовка секции в карточке — мелкий, uppercase,
// в text-muted цвете. Используется и для «Главы», и для «Транскрипт».
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "var(--text-xs)",
        color: "var(--text-muted)",
        marginBottom: "var(--space-3)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        fontWeight: 500,
      }}
    >
      {children}
    </div>
  );
}

// Контейнер-список с волосяной линией между строками. Без отдельных
// рамок у каждой строки — гораздо чище визуально, чем grid из bordered
// прямоугольников.
function NavList({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  );
}

// Одна строка списка: timecode слева в моно-шрифте, контент справа.
// Hover/active подсвечиваем фоном, между строками тонкая разделительная
// линия (вместо рамок). Полное body кликабельно.
function NavRow({
  active,
  onClick,
  timecode,
  children,
}: {
  active: boolean;
  onClick: () => void;
  timecode: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "60px 1fr",
        gap: "var(--space-3)",
        textAlign: "left",
        background: active ? "var(--bg-subtle)" : "transparent",
        border: "none",
        borderTop: "var(--hairline-w) solid var(--border)",
        borderRadius: 0,
        padding: "var(--space-3) var(--space-3)",
        color: "var(--text)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "var(--text-base)",
        transition: "background var(--transition)",
        margin: 0,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        style={{
          color: "var(--text-muted)",
          fontVariantNumeric: "tabular-nums",
          fontSize: "var(--text-xs)",
          fontFamily: "var(--font-mono)",
          alignSelf: "start",
          paddingTop: 2,
        }}
      >
        {timecode}
      </span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </button>
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
