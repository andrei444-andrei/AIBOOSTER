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
        maxWidth: 1200,
        margin: "0 auto",
        padding: "0 32px",
      }}
    >
      <HistoryPanel activeId={id} />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          maxWidth: 860,
          padding: "32px 0 64px",
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
          ← новый перевод
        </Link>
        <JobView jobId={id} />
      </main>
    </div>
  );
}
