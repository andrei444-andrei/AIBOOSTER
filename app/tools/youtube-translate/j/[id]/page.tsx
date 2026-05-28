import Link from "next/link";
import HistoryPanel from "../../HistoryPanel";
import JobView from "./JobView";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div
      style={{
        display: "flex",
        gap: 32,
        // Без maxWidth — иначе на широких экранах остаётся «пустая полоса»
        // справа. AppShell снаружи уже даёт левый сайдбар, дальше HistoryPanel
        // + main растягиваются по фактической ширине окна. Транскрипт-текст
        // внутри ограничивается ниже, чтобы не вытягиваться в простыню.
        padding: "0 32px 64px",
      }}
    >
      <HistoryPanel activeId={id} />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          padding: "32px 0 0 0",
          maxWidth: 1100,
        }}
      >
        <Link
          href="/tools/youtube-translate"
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
            textDecoration: "none",
            borderBottom: "1px solid var(--border)",
          }}
        >
          ← к библиотеке
        </Link>
        <JobView jobId={id} />
      </main>
    </div>
  );
}
