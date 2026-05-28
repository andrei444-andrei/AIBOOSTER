"use client";

import { useMemo, useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { TARGET_LANGUAGES, extractVideoId } from "@/lib/youtube";

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
    <Card as="form" onSubmit={submit} padded>
      <Input
        type="url"
        label="Ссылка на YouTube-видео"
        placeholder="https://www.youtube.com/watch?v=..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        autoFocus
        required
        errorText={error ?? undefined}
      />

      {videoId && (
        <div
          style={{
            marginTop: 14,
            display: "flex",
            gap: 12,
            alignItems: "center",
            padding: 10,
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
            alt=""
            width={120}
            height={68}
            style={{
              borderRadius: 4,
              flexShrink: 0,
              background: "var(--bg-muted)",
            }}
          />
          <div
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--text-secondary)",
              minWidth: 0,
            }}
          >
            <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>
              распознали ID:
            </div>
            <code
              style={{
                background: "var(--bg-muted)",
                padding: "1px 6px",
                borderRadius: 4,
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                color: "var(--text)",
              }}
            >
              {videoId}
            </code>
          </div>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <label
          htmlFor="yt-lang"
          style={{
            display: "block",
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
            marginBottom: 6,
          }}
        >
          Перевести на
        </label>
        <select
          id="yt-lang"
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text)",
            fontSize: "var(--text-base)",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        >
          {TARGET_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 20 }}>
        <span
          style={{
            display: "block",
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
            marginBottom: 6,
          }}
        >
          Качество озвучки
        </span>
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

      <Button
        type="submit"
        disabled={!canSubmit}
        loading={submitting}
        size="lg"
        style={{ width: "100%", marginTop: 24 }}
      >
        {submitting ? "Создаём задачу…" : "Перевести"}
      </Button>
    </Card>
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
        background: active ? "var(--bg-subtle)" : "var(--surface)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "var(--radius-sm)",
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
        transition: "var(--transition)",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: "var(--text-base)" }}>
        {props.title}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          marginTop: 2,
        }}
      >
        {props.subtitle}
      </div>
    </button>
  );
}
