import Link from "next/link";
import { ScraperLauncher } from "./ScraperLauncher";
import { CatalogPicker } from "./CatalogPicker";
import { listRecentRuns } from "@/lib/scraper/orchestrator";
import { Card, CardHeader, CardBody } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ScraperHomePage() {
  // Тихо: если БД ещё не готова, просто покажем пустой список — не валим страницу.
  let recent: Awaited<ReturnType<typeof listRecentRuns>> = [];
  try {
    recent = await listRecentRuns(20);
  } catch {
    recent = [];
  }

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "64px 32px" }}>
      <p
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        Модуль · AI Scraper
      </p>
      <h1 style={{ fontSize: 32, lineHeight: 1.15, margin: "0 0 12px" }}>
        Скажи что собрать — AI напишет код и принесёт данные.
      </h1>
      <p
        style={{
          fontSize: "var(--text-md)",
          color: "var(--text-secondary)",
          maxWidth: 640,
          margin: "0 0 32px",
        }}
      >
        Под капотом: твой текст → LLM генерирует JS-программу → она исполняется
        в нашем изолированном runner-актере на Apify → данные собираются в датасет → LLM
        делает выжимку. Без выбора селекторов, актеров и API.
      </p>

      <ScraperLauncher />

      <div style={{ marginTop: 48 }}>
        <CatalogPicker />
      </div>

      <section style={{ marginTop: 48 }}>
        <h2
          style={{
            fontSize: "var(--text-lg)",
            margin: "0 0 16px",
            color: "var(--text-secondary)",
          }}
        >
          Последние запуски
        </h2>
        {recent.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
            Пока пусто. Опиши задачу выше — она появится здесь.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {recent.map((r) => (
              <Link
                key={r.id}
                href={`/scraper/${r.id}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <Card interactive padded as="div">
                  <CardHeader
                    title={truncate(r.prompt, 80)}
                    subtitle={formatRunSubtitle(r)}
                    actions={<StatusBadge status={r.status} />}
                  />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function formatRunSubtitle(r: { created_at: string; result_count: number | null }): string {
  const when = new Date(r.created_at + "Z").toLocaleString("ru-RU");
  const count =
    r.result_count != null ? ` · ${r.result_count} строк` : "";
  return `${when}${count}`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string; bg: string }> = {
    pending: { label: "ожидает", color: "var(--text-muted)", bg: "var(--bg-subtle)" },
    planning: { label: "планирует", color: "var(--info)", bg: "var(--bg-subtle)" },
    running: { label: "идёт сбор", color: "var(--info)", bg: "var(--bg-subtle)" },
    summarizing: { label: "сводит", color: "var(--info)", bg: "var(--bg-subtle)" },
    succeeded: { label: "готово", color: "var(--success)", bg: "var(--bg-subtle)" },
    failed: { label: "сбой", color: "var(--danger)", bg: "var(--bg-subtle)" },
  };
  const c = config[status] ?? { label: status, color: "var(--text-muted)", bg: "var(--bg-subtle)" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        fontSize: "var(--text-sm)",
        color: c.color,
        background: c.bg,
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      {c.label}
    </span>
  );
}
