import Link from "next/link";
import TaskView from "./TaskView";
import styles from "../../build.module.css";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className={styles.page}>
      <Link
        href="/tools/english/build-sentences"
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--text-secondary)",
          textDecoration: "none",
          borderBottom: "1px solid var(--border)",
        }}
      >
        ← к заданиям
      </Link>
      <TaskView taskId={id} />
    </div>
  );
}
