"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, Button } from "@/components/ui";

const wrap: React.CSSProperties = {
  maxWidth: 920,
  margin: "0 auto",
  padding: "32px 24px 80px",
};

type Status = "open" | "reviewing" | "resolved" | "wontfix";
type Tab = Status | "all";

interface Report {
  id: string;
  item_id: string;
  enrichment_id: string | null;
  text: string;
  status: Status;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  item_title: string | null;
  item_url: string | null;
  source_name: string | null;
  article_body: string | null;
  synthesis_output_json: string | null;
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "open", label: "открыто" },
  { key: "reviewing", label: "в работе" },
  { key: "resolved", label: "закрыто" },
  { key: "wontfix", label: "не чиним" },
  { key: "all", label: "все" },
];

const STATUS_COLOR: Record<Status, string> = {
  open: "var(--danger)",
  reviewing: "var(--accent)",
  resolved: "var(--success)",
  wontfix: "var(--text-muted)",
};

const STATUS_LABEL: Record<Status, string> = {
  open: "открыт",
  reviewing: "в работе",
  resolved: "закрыт",
  wontfix: "не чиним",
};

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: "6px 14px",
  background: active ? "var(--text)" : "transparent",
  border: "1px solid " + (active ? "var(--text)" : "var(--border)"),
  borderRadius: 999,
  color: active ? "var(--text-on-accent)" : "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "inherit",
  fontWeight: 500,
});

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>("open");
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<Status | "all", number>>({
    open: 0,
    reviewing: 0,
    resolved: 0,
    wontfix: 0,
    all: 0,
  });

  const load = useCallback(async (which: Tab) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/news/reports?status=${which}&limit=200`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setReports(data.reports ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCounts = useCallback(async () => {
    try {
      const r = await fetch("/api/news/reports?status=all&limit=500");
      const data = await r.json();
      const all = (data.reports ?? []) as Report[];
      const c: Record<Status | "all", number> = {
        open: 0, reviewing: 0, resolved: 0, wontfix: 0, all: all.length,
      };
      for (const x of all) c[x.status] = (c[x.status] ?? 0) + 1;
      setCounts(c);
    } catch {
      // не критично
    }
  }, []);

  useEffect(() => { void load(tab); }, [tab, load]);
  useEffect(() => { void loadCounts(); }, [loadCounts]);

  const updateStatus = async (id: string, status: Status, resolution?: string) => {
    try {
      const r = await fetch(`/api/news/reports/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, resolution: resolution ?? null }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${r.status}`);
      }
      await load(tab);
      await loadCounts();
    } catch (e) {
      alert("Не удалось обновить статус: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <main style={wrap}>
      <header style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
            Репорты по статьям
          </h1>
          <nav style={{ display: "flex", gap: 14, fontSize: 13 }}>
            <Link href="/news" style={{ color: "var(--text-secondary)" }}>← лента</Link>
            <Link href="/news/agent-log" style={{ color: "var(--text-secondary)" }}>агент</Link>
          </nav>
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, margin: "0 0 14px" }}>
          Жалобы на содержимое статей: фактические ошибки, нерелевантные источники, обобщения, выдумка.
          Поток: <b>открыто</b> → <b>в работе</b> → <b>закрыто</b> / <b>не чиним</b>.
        </p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button key={t.key} style={tabBtn(tab === t.key)} onClick={() => setTab(t.key)}>
              {t.label} ({counts[t.key] ?? 0})
            </button>
          ))}
        </div>
      </header>

      {error && (
        <Card padded style={{ borderColor: "var(--danger)", marginBottom: 16 }}>
          <span style={{ color: "var(--danger)" }}>Ошибка: {error}</span>
        </Card>
      )}

      {loading && reports.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Загрузка…</div>
      ) : reports.length === 0 ? (
        <Card padded><p style={{ marginTop: 0 }}>Пусто.</p></Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {reports.map((r) => (
            <ReportRow key={r.id} r={r} onUpdate={updateStatus} />
          ))}
        </div>
      )}
    </main>
  );
}

function ReportRow({ r, onUpdate }: { r: Report; onUpdate: (id: string, st: Status, res?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState(r.resolution ?? "");
  // Готовый текст для копирования в чат
  const chatPrompt = buildChatPrompt(r);

  return (
    <Card padded>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: STATUS_COLOR[r.status], fontWeight: 600 }}>● {STATUS_LABEL[r.status]}</span>
            <span>·</span>
            <span>{new Date(r.created_at).toLocaleString("ru-RU")}</span>
            {r.source_name && (<><span>·</span><span>{r.source_name}</span></>)}
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
            {r.item_title || "(без заголовка)"}
          </div>
          {r.item_url && (
            <a href={r.item_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
              открыть оригинал ↗
            </a>
          )}
          <div style={{ marginTop: 10, padding: 10, background: "var(--bg-subtle)", borderRadius: 6, fontSize: 14, color: "var(--text)", whiteSpace: "pre-wrap" }}>
            {r.text}
          </div>
          {r.resolution && (
            <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-secondary)" }}>
              <b>Резолюция:</b> {r.resolution}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {r.status === "open" && (
          <Button onClick={() => onUpdate(r.id, "reviewing")}>взять в работу</Button>
        )}
        {(r.status === "open" || r.status === "reviewing") && (
          <Button onClick={() => {
            const res = window.prompt("Резолюция (что сделано):", "");
            if (res !== null) onUpdate(r.id, "resolved", res || undefined);
          }}>закрыть</Button>
        )}
        {(r.status === "open" || r.status === "reviewing") && (
          <Button onClick={() => {
            const res = window.prompt("Почему не чиним:", "");
            if (res !== null) onUpdate(r.id, "wontfix", res || undefined);
          }}>не чиним</Button>
        )}
        {(r.status === "resolved" || r.status === "wontfix") && (
          <Button onClick={() => onUpdate(r.id, "open")}>переоткрыть</Button>
        )}
        <Button onClick={() => setOpen(!open)}>
          {open ? "свернуть" : "разобрать в чате →"}
        </Button>
      </div>

      {open && (
        <div style={{ marginTop: 14, padding: 12, background: "var(--bg-subtle)", borderRadius: 6 }}>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
            Скопируй этот промт и вставь в <Link href="/chat" style={{ borderBottom: "1px solid var(--text-secondary)" }}>/chat</Link> — Claude разберёт ошибку и предложит план:
          </div>
          <pre style={{
            margin: 0,
            padding: 10,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 400,
            overflow: "auto",
            color: "var(--text)",
          }}>{chatPrompt}</pre>
          <Button onClick={() => {
            navigator.clipboard.writeText(chatPrompt).then(
              () => alert("Скопировано в буфер"),
              () => alert("Не удалось скопировать"),
            );
          }} style={{ marginTop: 8 } as React.CSSProperties}>📋 скопировать</Button>
        </div>
      )}
    </Card>
  );
}

function buildChatPrompt(r: Report): string {
  const body = r.article_body ? r.article_body.slice(0, 6000) : "(тело статьи не сохранено)";
  return [
    `Я отметил ошибку в карточке новостной ленты. Разбери жалобу и предложи план фикса (что в pipeline/промте поправить, какой источник почистить, нужно ли добавить guard).`,
    ``,
    `## Жалоба пользователя`,
    r.text,
    ``,
    `## Карточка`,
    `Заголовок: ${r.item_title ?? "—"}`,
    `Источник: ${r.source_name ?? "—"}`,
    `URL оригинала: ${r.item_url ?? "—"}`,
    ``,
    `## Тело синтезированной статьи (первые 6000 знаков)`,
    body,
  ].join("\n");
}
