"use client";

import { useMemo, useState } from "react";
import { TARGET_LANGUAGES, extractVideoId } from "@/lib/youtube";

const card: React.CSSProperties = {
  background: "#12161c",
  border: "1px solid #232a33",
  borderRadius: 10,
  padding: 20,
  marginTop: 24,
};
const label: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  opacity: 0.7,
  marginBottom: 6,
};
const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "#0b0d10",
  border: "1px solid #232a33",
  borderRadius: 6,
  color: "#e6e8eb",
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
};
const select: React.CSSProperties = { ...input };
const button: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  background: "#2b6cb0",
  border: 0,
  borderRadius: 6,
  color: "#fff",
  cursor: "pointer",
  fontSize: 15,
  fontWeight: 600,
};
const buttonDisabled: React.CSSProperties = {
  ...button,
  background: "#1f3a5f",
  cursor: "not-allowed",
};

export default function TranslateForm() {
  const [url, setUrl] = useState("");
  const [targetLang, setTargetLang] = useState("ru");
  const [quality, setQuality] = useState<"fast" | "best">("best");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoId = useMemo(() => extractVideoId(url), [url]);
  const canSubmit = Boolean(videoId) && !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!videoId) {
      setError("не похоже на ссылку YouTube");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/translate-video", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, target_lang: targetLang, quality }),
      });
      const data = await res.json();
      if (!res.ok || !data.job_id) {
        setError(data.error || `ошибка ${res.status}`);
        setSubmitting(false);
        return;
      }
      window.location.href = `/tools/youtube-translate/j/${data.job_id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} style={card}>
      <label style={label} htmlFor="yt-url">
        Ссылка на YouTube-видео
      </label>
      <input
        id="yt-url"
        type="url"
        placeholder="https://www.youtube.com/watch?v=..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        style={input}
        autoFocus
        required
      />

      {videoId && (
        <div
          style={{
            marginTop: 12,
            display: "flex",
            gap: 12,
            alignItems: "center",
            padding: 10,
            background: "#0b0d10",
            border: "1px solid #1a1e24",
            borderRadius: 6,
          }}
        >
          <img
            src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
            alt=""
            width={120}
            height={68}
            style={{ borderRadius: 4, flexShrink: 0, background: "#000" }}
          />
          <div style={{ fontSize: 13, opacity: 0.75, minWidth: 0 }}>
            <div style={{ opacity: 0.55, marginBottom: 4 }}>распознали ID:</div>
            <code
              style={{
                background: "#1a1e24",
                padding: "1px 6px",
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              {videoId}
            </code>
          </div>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <label style={label} htmlFor="yt-lang">
          Перевести на
        </label>
        <select
          id="yt-lang"
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
          style={select}
        >
          {TARGET_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 18 }}>
        <label style={label}>Качество озвучки</label>
        <div style={{ display: "flex", gap: 8 }}>
          <QualityChip
            value="best"
            current={quality}
            onSelect={setQuality}
            title="Лучшее"
            subtitle="ElevenLabs v2"
          />
          <QualityChip
            value="fast"
            current={quality}
            onSelect={setQuality}
            title="Быстро"
            subtitle="меньше деталей"
          />
        </div>
      </div>

      {error && (
        <div
          style={{
            marginTop: 14,
            padding: 10,
            background: "#3a1a1a",
            border: "1px solid #7a2b2b",
            borderRadius: 6,
            color: "#ffb4b4",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        style={{ ...(canSubmit ? button : buttonDisabled), marginTop: 20 }}
      >
        {submitting ? "Создаём задачу…" : "Перевести →"}
      </button>
    </form>
  );
}

function QualityChip(props: {
  value: "fast" | "best";
  current: "fast" | "best";
  onSelect: (v: "fast" | "best") => void;
  title: string;
  subtitle: string;
}) {
  const active = props.value === props.current;
  return (
    <button
      type="button"
      onClick={() => props.onSelect(props.value)}
      style={{
        flex: 1,
        padding: "10px 12px",
        background: active ? "#1a3a5f" : "#0b0d10",
        border: `1px solid ${active ? "#2b6cb0" : "#232a33"}`,
        borderRadius: 6,
        color: "#e6e8eb",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 14 }}>{props.title}</div>
      <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>{props.subtitle}</div>
    </button>
  );
}
