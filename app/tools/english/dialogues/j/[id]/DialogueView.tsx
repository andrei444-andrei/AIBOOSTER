"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import styles from "../../english.module.css";

type Stage = "script" | "tts" | "mux" | null;
type Status = "queued" | "running" | "done" | "error" | "cancelled";
type WatchStatus = "to_watch" | "watched";

interface JobDto {
  id: string;
  topic: string;
  title: string | null;
  kind: "dialogue" | "monologue";
  duration_min: number;
  with_translation: number;
  status: Status;
  stage: Stage;
  progress: number;
  error_message: string | null;
  error_id: string | null;
  audio_url: string | null;
  duration_sec: number | null;
  watch_status: WatchStatus;
  last_position_sec: number;
  created_at: string;
}

interface SegmentDto {
  idx: number;
  start_ms: number;
  end_ms: number;
  speaker: string | null;
  en_text: string;
  ru_text: string | null;
}

interface ApiResponse {
  job: JobDto;
  segments: SegmentDto[];
}

const STAGE_LABEL: Record<Exclude<Stage, null>, string> = {
  script: "Пишем сценарий",
  tts: "Озвучиваем реплики",
  mux: "Собираем аудио",
};
const STAGE_ORDER: Exclude<Stage, null>[] = ["script", "tts", "mux"];

// Скорость воспроизведения (как в подкаст-плеере). Выбор запоминается глобально
// в localStorage и применяется ко всем разговорам. Для учащихся важны медленные
// значения, поэтому по умолчанию чуть медленнее обычного.
const RATE_KEY = "english_dialogue_rate";
const RATE_OPTIONS = [0.6, 0.75, 0.9, 1, 1.25];
const DEFAULT_RATE = 0.9;
function readSavedRate(): number {
  if (typeof window === "undefined") return DEFAULT_RATE;
  const v = Number(localStorage.getItem(RATE_KEY));
  return RATE_OPTIONS.includes(v) ? v : DEFAULT_RATE;
}

export default function DialogueView({ jobId }: { jobId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Поллинг каждые 2с пока queued/running.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const res = await fetch(`/api/english-dialogues/${jobId}`, { cache: "no-store" });
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
        <span style={{ color: "var(--text-secondary)" }}>Загружаем разговор…</span>
      </Card>
    );
  }
  if (fetchError && !data) {
    return (
      <Card padded style={{ marginTop: 24, borderColor: "var(--danger)", background: "var(--danger-bg)" }}>
        <span style={{ color: "var(--danger)" }}>Не удалось загрузить: {fetchError}</span>
      </Card>
    );
  }
  if (!data) return null;

  const { job, segments } = data;

  return (
    <div>
      <Hero job={job} />

      {(job.status === "queued" || job.status === "running") && <ProgressCard job={job} />}

      {job.status === "error" && (
        <Card padded style={{ marginTop: 20, borderColor: "var(--danger)", background: "var(--danger-bg)" }}>
          <div style={{ color: "var(--danger)", fontWeight: 600, marginBottom: 6 }}>
            Что-то пошло не так
          </div>
          <div style={{ fontSize: "var(--text-base)", color: "var(--text)" }}>
            {job.error_message || "неизвестная ошибка"}
          </div>
          {job.error_id && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
              error_id: <code style={{ fontFamily: "var(--font-mono)" }}>{job.error_id}</code>
            </div>
          )}
          <Link href="/tools/english/dialogues" style={{ display: "inline-block", marginTop: 14 }}>
            <Button variant="primary">Сгенерировать заново</Button>
          </Link>
        </Card>
      )}

      {job.status === "done" && job.audio_url && <ResultCard job={job} segments={segments} />}
    </div>
  );
}

function Hero({ job }: { job: JobDto }) {
  return (
    <Card padded style={{ marginTop: 20 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <Tag>{job.kind === "monologue" ? "монолог" : "диалог"}</Tag>
        <Tag>{job.duration_min} мин</Tag>
        {job.with_translation === 1 && <Tag>с переводом</Tag>}
      </div>
      <h1 className={styles.heroTitle}>{job.title || "Разговор на английском"}</h1>
      <p style={{ margin: 0, fontSize: "var(--text-base)", color: "var(--text-secondary)", lineHeight: "var(--leading-relaxed)" }}>
        {job.topic}
      </p>
    </Card>
  );
}

function ProgressCard({ job }: { job: JobDto }) {
  const currentIdx = job.stage ? STAGE_ORDER.indexOf(job.stage) : -1;
  return (
    <Card padded style={{ marginTop: 20 }}>
      <div style={{ marginBottom: 12, fontSize: "var(--text-base)", color: "var(--text-secondary)" }}>
        {job.status === "queued" ? "В очереди — скоро возьмём в работу" : "Генерируем разговор"}
        {" · "}
        <strong style={{ color: "var(--text)" }}>{job.progress}%</strong>
      </div>
      <div style={{ height: 6, background: "var(--bg-subtle)", borderRadius: 3, overflow: "hidden", marginBottom: 18 }}>
        <div style={{ width: `${job.progress}%`, height: "100%", background: "var(--accent)", transition: "width 400ms var(--ease)" }} />
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {STAGE_ORDER.map((s, i) => {
          const done = currentIdx > i || job.status === "done";
          const active = currentIdx === i && job.status === "running";
          const muted = !done && !active;
          return (
            <div key={s} style={{ display: "flex", gap: 10, alignItems: "center", color: muted ? "var(--text-muted)" : "var(--text)" }}>
              <span style={{ width: 16, textAlign: "center", color: done ? "var(--success)" : active ? "var(--info)" : "var(--text-muted)" }}>
                {done ? "✓" : active ? "▣" : "·"}
              </span>
              <span style={{ fontSize: "var(--text-base)" }}>{STAGE_LABEL[s]}</span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 18, fontSize: 12, color: "var(--text-muted)" }}>
        Можно закрыть вкладку — вернись по этой же ссылке, прогресс не потеряется.
      </div>
    </Card>
  );
}

function ResultCard({ job, segments }: { job: JobDto; segments: SegmentDto[] }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [watchStatus, setWatchStatus] = useState<WatchStatus>(job.watch_status);
  const [rate, setRate] = useState<number>(() => readSavedRate());
  const lastSavedRef = useRef<number>(job.last_position_sec);

  // Прыжок на сохранённую позицию когда аудио готов (резюм с той же секунды).
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
          // некоторые браузеры не дают ставить currentTime до loadedmetadata
        }
      }
    }
    a.addEventListener("loadedmetadata", seedPosition);
    return () => a.removeEventListener("loadedmetadata", seedPosition);
  }, [job.last_position_sec]);

  // Подсветка активной фразы + периодическое сохранение позиции (раз в 5с).
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      setCurrentMs(Math.round(a.currentTime * 1000));
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
      // Дослушали до конца → авто-перенос в «Завершённые».
      lastSavedRef.current = 0;
      setWatchStatus("watched");
      void savePlayback(job.id, { last_position_sec: 0, watch_status: "watched" });
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

  // Сохраняем позицию при закрытии вкладки (keepalive довезёт PATCH).
  useEffect(() => {
    function flush() {
      const a = audioRef.current;
      if (!a) return;
      try {
        void fetch(`/api/english-dialogues/${job.id}`, {
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

  // Применяем скорость к аудио. preservesPitch сохраняет тембр при замедлении
  // (иначе голос «плыл» бы по высоте). Перевыставляем на loadedmetadata/play,
  // т.к. некоторые браузеры сбрасывают playbackRate при загрузке источника.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const apply = () => {
      try {
        (a as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
        a.playbackRate = rate;
      } catch {
        /* ignore */
      }
    };
    apply();
    a.addEventListener("loadedmetadata", apply);
    a.addEventListener("play", apply);
    return () => {
      a.removeEventListener("loadedmetadata", apply);
      a.removeEventListener("play", apply);
    };
  }, [rate]);

  function changeRate(r: number) {
    setRate(r);
    try {
      localStorage.setItem(RATE_KEY, String(r));
    } catch {
      /* ignore */
    }
  }

  const activeIdx = segments.findIndex((s) => currentMs >= s.start_ms && currentMs < s.end_ms);

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
        <div className={styles.actionsRow}>
          <Button
            size="sm"
            variant={watchStatus === "watched" ? "secondary" : "primary"}
            onClick={toggleWatched}
            leadingIcon={watchStatus === "watched" ? <span>✓</span> : null}
          >
            {watchStatus === "watched" ? "В прослушанных" : "В прослушанные"}
          </Button>
          <LinkChip href={job.audio_url ?? "#"} download leading="↓">
            mp3
          </LinkChip>
          <SpeedControl rate={rate} onChange={changeRate} />
        </div>
      </Card>

      {segments.length > 0 && (
        <Card padded style={{ marginTop: 20 }}>
          <SectionLabel>Транскрипт</SectionLabel>
          <NavList>
            {segments.map((s, i) => {
              const active = i === activeIdx;
              return (
                <NavRow key={s.idx} active={active} onClick={() => seekTo(s.start_ms)} timecode={formatTimecode(s.start_ms)}>
                  <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "baseline" }}>
                    {s.speaker && (
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: 11,
                          fontWeight: 700,
                          color: s.speaker === "B" ? "var(--info)" : "var(--accent)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {s.speaker}
                      </span>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ lineHeight: "var(--leading-normal)", fontWeight: active ? 600 : 500 }}>
                        {s.en_text}
                      </div>
                      {s.ru_text && (
                        <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", marginTop: 2, lineHeight: "var(--leading-normal)" }}>
                          {s.ru_text}
                        </div>
                      )}
                    </div>
                  </div>
                </NavRow>
              );
            })}
          </NavList>
        </Card>
      )}
    </>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 500,
        color: "var(--text-secondary)",
        background: "var(--bg-subtle)",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

// Переключатель скорости воспроизведения — компактные чипы 0.6×…1.25×.
function SpeedControl({ rate, onChange }: { rate: number; onChange: (r: number) => void }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Скорость</span>
      <div style={{ display: "inline-flex", gap: 2 }}>
        {RATE_OPTIONS.map((r) => {
          const active = Math.abs(r - rate) < 0.001;
          return (
            <button
              key={r}
              type="button"
              onClick={() => onChange(r)}
              aria-pressed={active}
              style={{
                padding: "2px 7px",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                background: active ? "var(--accent)" : "transparent",
                color: active ? "var(--text-on-accent)" : "var(--text-secondary)",
                border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
              }}
            >
              {r}×
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LinkChip({
  href,
  children,
  leading,
  download,
}: {
  href: string;
  children: React.ReactNode;
  leading?: string;
  download?: boolean;
}) {
  return (
    <a
      href={href}
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
      }}
    >
      {leading && <span aria-hidden>{leading}</span>}
      <span>{children}</span>
    </a>
  );
}

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

function NavList({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column" }}>{children}</div>;
}

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
        gridTemplateColumns: "52px 1fr",
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
    >
      <span
        style={{
          color: "var(--text-muted)",
          fontVariantNumeric: "tabular-nums",
          fontSize: "var(--text-xs)",
          fontFamily: "var(--font-mono)",
          alignSelf: "start",
          paddingTop: 4,
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

async function savePlayback(
  jobId: string,
  body: { last_position_sec?: number; watch_status?: WatchStatus },
): Promise<void> {
  try {
    await fetch(`/api/english-dialogues/${jobId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    // не критично — сохранится на следующем событии
  }
}
