"use client";

import { useState } from "react";
import { Button, Card, Textarea } from "@/components/ui";

export default function GenerateForm() {
  const [topic, setTopic] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) {
      setError("напиши тему");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/english-sentences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: topic.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.task_id) {
        setError(data.error || `ошибка ${res.status}`);
        setSubmitting(false);
        return;
      }
      window.location.href = `/tools/english/build-sentences/t/${data.task_id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <Card as="form" onSubmit={submit} padded>
      <Textarea
        label="Тема, на которую сгенерировать предложения"
        placeholder="Например: путешествия и аэропорт; рабочая переписка; Present Perfect на практике…"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        rows={3}
        autoFocus
        required
        errorText={error ?? undefined}
      />
      <Button
        type="submit"
        disabled={!topic.trim() || submitting}
        loading={submitting}
        size="lg"
        style={{ width: "100%", marginTop: 16 }}
      >
        {submitting ? "Генерируем 10 предложений…" : "Сгенерировать задание"}
      </Button>
    </Card>
  );
}
