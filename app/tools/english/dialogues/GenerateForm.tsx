"use client";

import { useState } from "react";
import { Button, Card, Textarea } from "@/components/ui";
import styles from "./english.module.css";

type Kind = "dialogue" | "monologue";

export default function GenerateForm() {
  const [topic, setTopic] = useState("");
  const [durationMin, setDurationMin] = useState(5);
  const [kind, setKind] = useState<Kind>("dialogue");
  const [withTranslation, setWithTranslation] = useState(false);
  const [speed, setSpeed] = useState(0.9);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = topic.trim().length > 0 && !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) {
      setError("напиши тему разговора");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/english-dialogues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          duration_min: durationMin,
          kind,
          with_translation: withTranslation,
          speed,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.job_id) {
        setError(data.error || `ошибка ${res.status}`);
        setSubmitting(false);
        return;
      }
      window.location.href = `/tools/english/dialogues/j/${data.job_id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <Card as="form" onSubmit={submit} padded>
      <Textarea
        label="О чём сгенерировать разговор?"
        placeholder="Например: собеседование на работу в IT-компанию; заказ еды в кафе в Лондоне; обсуждение любимого фильма…"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        rows={3}
        autoFocus
        required
        errorText={error ?? undefined}
      />

      {/* Длительность — ползунок 3..10 минут */}
      <div style={{ marginTop: 20 }}>
        <label htmlFor="dlg-duration" className={styles.fieldLabel}>
          Длительность:{" "}
          <strong style={{ color: "var(--text)" }}>{durationMin} мин</strong>
        </label>
        <input
          id="dlg-duration"
          type="range"
          min={3}
          max={10}
          step={1}
          value={durationMin}
          onChange={(e) => setDurationMin(Number(e.target.value))}
          style={{ width: "100%", accentColor: "var(--accent)" }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          <span>3</span>
          <span>10</span>
        </div>
      </div>

      {/* Скорость озвучки — ползунок 0.7..1.2× (запекается в аудио) */}
      <div style={{ marginTop: 20 }}>
        <label htmlFor="dlg-speed" className={styles.fieldLabel}>
          Скорость озвучки:{" "}
          <strong style={{ color: "var(--text)" }}>{speed.toFixed(2)}×</strong>
        </label>
        <input
          id="dlg-speed"
          type="range"
          min={0.7}
          max={1.2}
          step={0.05}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          style={{ width: "100%", accentColor: "var(--accent)" }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          <span>0.7× медленнее</span>
          <span>быстрее 1.2×</span>
        </div>
      </div>

      {/* Тип: диалог / монолог */}
      <div style={{ marginTop: 20 }}>
        <span className={styles.fieldLabel}>Тип</span>
        <div className={styles.segRow}>
          <SegChip
            active={kind === "dialogue"}
            onClick={() => setKind("dialogue")}
            title="Диалог"
            sub="два собеседника"
          />
          <SegChip
            active={kind === "monologue"}
            onClick={() => setKind("monologue")}
            title="Монолог"
            sub="один говорящий"
          />
        </div>
      </div>

      {/* Перевод: да / нет */}
      <div style={{ marginTop: 20 }}>
        <span className={styles.fieldLabel}>Перевод на русский</span>
        <div className={styles.segRow}>
          <SegChip
            active={!withTranslation}
            onClick={() => setWithTranslation(false)}
            title="Нет"
            sub="только английский"
          />
          <SegChip
            active={withTranslation}
            onClick={() => setWithTranslation(true)}
            title="Да"
            sub="после каждой фразы — перевод"
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
        {submitting ? "Создаём разговор…" : "Генерировать"}
      </Button>
    </Card>
  );
}

function SegChip(props: {
  active: boolean;
  onClick: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`${styles.segChip} ${props.active ? styles.segChipActive : ""}`}
    >
      <div className={styles.segChipTitle}>{props.title}</div>
      <div className={styles.segChipSub}>{props.sub}</div>
    </button>
  );
}
