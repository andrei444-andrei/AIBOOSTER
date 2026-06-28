import Link from "next/link";
import SessionLog from "./SessionLog";
import styles from "../../live.module.css";

export const dynamic = "force-dynamic";

export default async function SessionLogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className={styles.page}>
      <Link
        href="/tools/english/live-dialogue"
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--text-secondary)",
          textDecoration: "none",
          borderBottom: "1px solid var(--border)",
        }}
      >
        ← к диалогам
      </Link>
      <SessionLog id={id} />
    </div>
  );
}
