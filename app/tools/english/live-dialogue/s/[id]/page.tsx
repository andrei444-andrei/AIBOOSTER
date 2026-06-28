import Link from "next/link";
import LiveDialogueApp from "../../LiveDialogueApp";
import styles from "../../live.module.css";

export const dynamic = "force-dynamic";

// Открытие сессии: активную — продолжаем (резюм), завершённую — показываем лог.
// Обе ветки обрабатывает LiveDialogueApp по resumeId.
export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
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
      <h1 className={styles.title} style={{ fontSize: 24 }}>Живой диалог</h1>
      <LiveDialogueApp resumeId={id} />
    </div>
  );
}
