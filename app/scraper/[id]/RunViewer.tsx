"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import type { ScraperRunView, ScraperStatus } from "@/lib/scraper/types";

const POLL_INTERVAL_MS = 3000;
const TERMINAL: ScraperStatus[] = ["succeeded", "failed"];

export function RunViewer({ initial }: { initial: ScraperRunView }) {
  const [run, setRun] = useState<ScraperRunView>(initial);
  const [showCode, setShowCode] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (TERMINAL.includes(run.status)) return;

    let cancelled = false;

    async function tick() {
      try {
        const resp = await fetch(`/api/scraper/runs/${initial.id}`, {
          cache: "no-store",
        });
        if (resp.ok) {
          const data = (await resp.json()) as ScraperRunView;
          if (!cancelled) setRun(data);
        }
      } catch {
        // молча, повторим
      }
      if (!cancelled && !TERMINAL.includes(run.status)) {
        timerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
      }
    }

    timerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.status, initial.id]);

  const attempt = run.attempts[0];

  return (
    <div>
      <p
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        Запуск · {run.id.slice(0, 8)}
      </p>
      <h1
        style={{
          fontSize: 24,
          lineHeight: 1.25,
          margin: "0 0 16px",
          fontWeight: 500,
        }}
      >
        {run.prompt}
      </h1>

      <StatusLine status={run.status} run={run} />

      {attempt?.reasoning ? (
        <Card style={{ marginTop: 24 }}>
          <CardHeader title="План AI" />
          <CardBody>
            <p style={{ margin: 0, color: "var(--text-secondary)" }}>
              {attempt.reasoning}
            </p>
          </CardBody>
        </Card>
      ) : null}

      {run.status === "failed" && run.error_message ? (
        <Card style={{ marginTop: 24, borderColor: "var(--danger)" }}>
          <CardHeader title="Сбой" />
          <CardBody>
            <p style={{ margin: 0 }}>{run.error_message}</p>
            {run.error_id ? (
              <p
                style={{
                  margin: "8px 0 0",
                  color: "var(--text-muted)",
                  fontSize: "var(--text-sm)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                error_id: {run.error_id}
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {run.status === "succeeded" && run.result_summary ? (
        <Card style={{ marginTop: 24 }}>
          <CardHeader
            title={`Сводка · ${run.result_count ?? 0} строк`}
          />
          <CardBody>
            <div
              style={{
                whiteSpace: "pre-wrap",
                color: "var(--text-secondary)",
                lineHeight: 1.55,
              }}
            >
              {run.result_summary}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {run.items_preview && run.items_preview.length > 0 ? (
        <Card style={{ marginTop: 24 }}>
          <CardHeader
            title="Данные"
            subtitle={`Первые ${run.items_preview.length} строк`}
          />
          <CardBody style={{ overflowX: "auto" }}>
            <ItemsTable items={run.items_preview} />
          </CardBody>
        </Card>
      ) : null}

      {attempt?.code ? (
        <Card style={{ marginTop: 24 }}>
          <CardHeader
            title="Код, который написал AI"
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCode((v) => !v)}
              >
                {showCode ? "Скрыть" : "Показать"}
              </Button>
            }
          />
          {showCode ? (
            <CardBody>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "var(--text-sm)",
                  fontFamily: "var(--font-mono)",
                  overflow: "auto",
                  maxHeight: 400,
                }}
              >
                {attempt.code}
              </pre>
            </CardBody>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function StatusLine({
  status,
  run,
}: {
  status: ScraperStatus;
  run: ScraperRunView;
}) {
  const steps: { key: ScraperStatus; label: string }[] = [
    { key: "planning", label: "AI пишет код" },
    { key: "running", label: "Скрейпер собирает данные" },
    { key: "summarizing", label: "AI делает выжимку" },
    { key: "succeeded", label: "Готово" },
  ];

  const order: ScraperStatus[] = ["pending", "planning", "running", "summarizing", "succeeded"];
  const currentIdx = order.indexOf(status);

  if (status === "failed") {
    return (
      <div
        style={{
          padding: "8px 12px",
          background: "var(--bg-subtle)",
          border: "1px solid var(--danger)",
          borderRadius: "var(--radius-sm)",
          fontSize: "var(--text-sm)",
          color: "var(--danger)",
        }}
      >
        Запуск завершился ошибкой.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      {steps.map((s, i) => {
        const done = currentIdx > order.indexOf(s.key);
        const active = currentIdx === order.indexOf(s.key);
        return (
          <span
            key={s.key}
            style={{
              padding: "4px 10px",
              fontSize: "var(--text-sm)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: active
                ? "var(--info)"
                : done
                  ? "var(--success)"
                  : "var(--text-muted)",
              background: active ? "var(--bg-subtle)" : "transparent",
              fontWeight: active ? 500 : 400,
            }}
          >
            {done ? "✓ " : active ? "● " : "○ "}
            {s.label}
          </span>
        );
      })}
      {run.apify_run_id && currentIdx >= order.indexOf("running") ? (
        <a
          href={`https://console.apify.com/actors/runs/${run.apify_run_id}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            marginLeft: "auto",
            fontSize: "var(--text-sm)",
            color: "var(--text-muted)",
            textDecoration: "none",
          }}
        >
          Apify console →
        </a>
      ) : null}
    </div>
  );
}

function ItemsTable({ items }: { items: unknown[] }) {
  if (items.length === 0) return null;
  const cols = collectColumns(items);
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: "var(--text-sm)",
      }}
    >
      <thead>
        <tr>
          {cols.map((c) => (
            <th
              key={c}
              style={{
                textAlign: "left",
                padding: "8px 10px",
                borderBottom: "1px solid var(--border)",
                color: "var(--text-secondary)",
                fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <td
                key={c}
                style={{
                  padding: "8px 10px",
                  borderBottom: "1px solid var(--border)",
                  verticalAlign: "top",
                  maxWidth: 320,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {renderCell((item as Record<string, unknown>)[c])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function collectColumns(items: unknown[]): string[] {
  const set = new Set<string>();
  for (const it of items) {
    if (it && typeof it === "object") {
      for (const k of Object.keys(it as object)) set.add(k);
    }
  }
  return Array.from(set);
}

function renderCell(v: unknown): React.ReactNode {
  if (v == null) return "";
  if (typeof v === "string") {
    if (/^https?:\/\//.test(v)) {
      return (
        <a href={v} target="_blank" rel="noopener noreferrer">
          {v.length > 40 ? v.slice(0, 39) + "…" : v}
        </a>
      );
    }
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}
