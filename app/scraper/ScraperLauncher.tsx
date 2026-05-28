"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea, useToast } from "@/components/ui";

const EXAMPLES = [
  "Найди вакансии медиабайеров на hh.ru в Москве, собери заголовок, зарплату, компанию и ссылку",
  "Собери первые 30 товаров в категории «беспроводные наушники» на dns-shop.ru с ценой и рейтингом",
  "Парсинг последних 20 статей с habr.com по тегу «react», заголовок, автор, рейтинг, ссылка",
];

export function ScraperLauncher() {
  const [prompt, setPrompt] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const router = useRouter();

  async function submit() {
    const text = prompt.trim();
    if (!text) {
      toast.warning({ title: "Поле пустое", message: "Опиши задачу" });
      return;
    }

    startTransition(async () => {
      try {
        const resp = await fetch("/api/scraper/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text }),
        });
        const data = (await resp.json()) as
          | { runId: string }
          | { error: { message: string; error_id?: string } };

        if (!resp.ok || "error" in data) {
          const err = "error" in data ? data.error : { message: "Неизвестная ошибка" };
          toast.error({
            title: "Не удалось запустить",
            message: err.error_id
              ? `${err.message} (error_id: ${err.error_id})`
              : err.message,
          });
          return;
        }

        router.push(`/scraper/${data.runId}`);
      } catch (err) {
        toast.error({
          title: "Сетевой сбой",
          message: err instanceof Error ? err.message : "Неизвестная ошибка",
        });
      }
    });
  }

  return (
    <div>
      <Textarea
        label="Что собрать?"
        helperText="Опиши задачу обычным языком. Чем конкретнее источник и нужные поля — тем точнее результат."
        placeholder="Например: найди вакансии Python-разработчиков в Москве на hh.ru с зарплатой от 250к"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        disabled={pending}
      />
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Button onClick={submit} loading={pending} disabled={pending}>
          {pending ? "Запускаю..." : "Запустить"}
        </Button>
        <span style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
          Примеры:
        </span>
        {EXAMPLES.map((ex, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setPrompt(ex)}
            disabled={pending}
            style={{
              background: "transparent",
              border: "1px dashed var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "4px 8px",
              fontSize: "var(--text-sm)",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            {ex.length > 40 ? ex.slice(0, 39) + "…" : ex}
          </button>
        ))}
      </div>
    </div>
  );
}
