"use client";

import { useEffect, useRef, useState } from "react";

type Stage = "download" | "asr" | "translate" | "tts" | "mux" | null;
type Status = "queued" | "running" | "done" | "error" | "cancelled";

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

const card: React.CSSProperties = {
  background: "#12161c",
  border: "1px solid #232a33",
  borderRadius: 10,
  padding: 20,
  marginTop: 20,
};

const STAGE_LABEL: Record<Exclude<Stage, null>, string> = {
  download: "Скачиваем аудио",
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
      <div style={card}>
        <div style={{ opacity: 0.7 }}>Загружаем задачу…</div>
      </div>
    );
  }
  if (fetchError && !data) {
    return (
      <div style={{ ...card, borderColor: "#7a2b2b" }}>
        <div style={{ color: "#ff7b72" }}>Не удалось загрузить задачу: {fetchError}</div>
      </div>
    );
  }
  if (!data) return null;

  const { job, segments } = data;

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 16, marginBottom: 4 }}>
        {job.title || "Перевод видео"}
      </h1>
      <div style={{ opacity: 0.55, fontSize: 13 }}>
        {job.video_id} · перевод на <b>{job.target_lang}</b>
        {job.duration_sec ? ` · ${formatDuration(job.duration_sec)}` : ""}
        {" · "}
        <a href={`https://youtu.be/${job.video_id}`} target="_blank" rel="noopener" style={{ color: "#79b8ff" }}>
          оригинал ↗
        </a>
      </div>

      {(job.status === "queued" || job.status === "running") && (
        <ProgressCard job={job} />
      )}

      {job.status === "error" && (
        <div style={{ ...card, borderColor: "#7a2b2b" }}>
          <div style={{ color: "#ff7b72", fontWeight: 600, marginBottom: 6 }}>
            Что-то пошло не так
          </div>
          <div style={{ fontSize: 14 }}>{job.error_message || "неизвестная ошибка"}</div>
          {job.error_id && (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.5 }}>
              error_id: <code>{job.error_id}</code>
            </div>
          )}
          <a
            href="/tools/youtube-translate"
            style={{
              display: "inline-block",
              marginTop: 14,
              padding: "8px 14px",
              background: "#2b6cb0",
              borderRadius: 6,
              color: "#fff",
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            Попробовать снова
          </a>
        </div>
      )}

      {job.status === "done" && job.audio_url && (
        <ResultCard job={job} segments={segments} />
      )}
    </div>
  );
}

function ProgressCard({ job }: { job: JobDto }) {
  const currentIdx = job.stage ? STAGE_ORDER.indexOf(job.stage) : -1;
  return (
    <div style={card}>
      <div style={{ marginBottom: 12, fontSize: 14, opacity: 0.8 }}>
        {job.status === "queued"
          ? "В очереди — скоро возьмём в работу"
          : "Обрабатываем"}
        {" · "}
        {job.progress}%
      </div>
      <div
        style={{
          height: 6,
          background: "#0b0d10",
          borderRadius: 3,
          overflow: "hidden",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            width: `${job.progress}%`,
            height: "100%",
            background: "linear-gradient(90deg,#2b6cb0,#79b8ff)",
            transition: "width 400ms ease",
          }}
        />
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {STAGE_ORDER.map((s, i) => {
          const done = currentIdx > i || job.status === "done";
          const active = currentIdx === i && job.status === "running";
          return (
            <div
              key={s}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                opacity: done || active ? 1 : 0.45,
              }}
            >
              <span style={{ width: 16, textAlign: "center", color: done ? "#5fd068" : active ? "#79b8ff" : "#666" }}>
                {done ? "✓" : active ? "▣" : "·"}
              </span>
              <span style={{ fontSize: 14 }}>{STAGE_LABEL[s]}</span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 18, fontSize: 12, opacity: 0.5 }}>
        Можно закрыть вкладку — вернись по этой же ссылке, прогресс не потеряется.
      </div>
    </div>
  );
}

function ResultCard({ job, segments }: { job: JobDto; segments: SegmentDto[] }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCurrentMs(Math.round(a.currentTime * 1000));
    a.addEventListener("timeupdate", onTime);
    return () => a.removeEventListener("timeupdate", onTime);
  }, []);

  const activeIdx = segments.findIndex(
    (s) => currentMs >= s.start_ms && currentMs < s.end_ms,
  );

  function seekTo(ms: number) {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = ms / 1000;
    a.play().catch(() => {});
  }

  return (
    <>
      <div style={card}>
        <audio
          ref={audioRef}
          src={job.audio_url ?? undefined}
          controls
          preload="metadata"
          style={{ width: "100%" }}
        />
        <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          <a
            href={job.audio_url ?? "#"}
            download
            style={{
              padding: "6px 12px",
              background: "#1a3a5f",
              borderRadius: 6,
              color: "#e6e8eb",
              textDecoration: "none",
              fontSize: 13,
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
              background: "#1a3a5f",
              borderRadius: 6,
              color: "#e6e8eb",
              textDecoration: "none",
              fontSize: 13,
            }}
          >
            Открыть оригинал на YouTube ↗
          </a>
          {segments.length > 0 && segments.some((s) => s.source_text) && (
            <label
              style={{
                padding: "6px 12px",
                background: "#1a3a5f",
                borderRadius: 6,
                color: "#e6e8eb",
                fontSize: 13,
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
      </div>

      {segments.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 14, opacity: 0.7, marginBottom: 10 }}>
            Транскрипт ({job.target_lang.toUpperCase()})
            {showOriginal && job.source_lang ? ` ← ${job.source_lang.toUpperCase()}` : ""}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
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
                    background: active ? "#1a3a5f" : "transparent",
                    border: `1px solid ${active ? "#2b6cb0" : "transparent"}`,
                    borderRadius: 6,
                    padding: "8px 10px",
                    color: "#e6e8eb",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}
                >
                  <span style={{ opacity: 0.55, fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
                    {formatTimecode(s.start_ms)}
                  </span>
                  <span>
                    <div>{s.translated_text || <em style={{ opacity: 0.4 }}>—</em>}</div>
                    {showOriginal && s.source_text && (
                      <div style={{ opacity: 0.5, fontSize: 13, marginTop: 2 }}>
                        {s.source_text}
                      </div>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
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
