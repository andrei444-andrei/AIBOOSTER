import Link from "next/link";
import HistoryPanel from "../../HistoryPanel";
import JobView from "./JobView";
import styles from "../../youtube.module.css";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className={styles.page}>
      <div className={styles.historyPanel}>
        <HistoryPanel activeId={id} />
      </div>
      <main className={styles.main}>
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
