import Link from "next/link";
import GenerateForm from "./GenerateForm";
import Library from "./Library";
import styles from "./build.module.css";

export const dynamic = "force-dynamic";

export default function BuildSentencesPage() {
  return (
    <div className={styles.libraryPage}>
      <Link
        href="/tools/english"
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--text-secondary)",
          textDecoration: "none",
          borderBottom: "1px solid var(--border)",
        }}
      >
        ← Английский
      </Link>
      <h1 className={styles.libraryTitle}>Build sentences</h1>
      <p className={styles.libraryIntro}>
        Напиши тему — AI сгенерирует 10 предложений. Каждое разбито на куски,
        которые нужно собрать в правильном порядке: перетаскивай куски, тапни по
        куску — увидишь перевод. Ошибся — покажем памятку по структуре. Когда
        соберёшь все предложения, задание уедет в «Сделано».
      </p>

      <div style={{ marginBottom: "var(--space-8)" }}>
        <GenerateForm />
      </div>

      <Library />
    </div>
  );
}
