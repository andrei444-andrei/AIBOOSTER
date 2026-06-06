import Link from "next/link";
import DialogueView from "./DialogueView";
import styles from "../../english.module.css";

export const dynamic = "force-dynamic";

export default async function DialoguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className={styles.page}>
      <Link
        href="/tools/english/dialogues"
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--text-secondary)",
          textDecoration: "none",
          borderBottom: "1px solid var(--border)",
        }}
      >
        ← к разговорам
      </Link>
      <DialogueView jobId={id} />
    </div>
  );
}
