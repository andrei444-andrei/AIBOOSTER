import Link from "next/link";
import LiveDialogueApp from "./LiveDialogueApp";
import styles from "./live.module.css";

export const dynamic = "force-dynamic";

export default function LiveDialoguePage() {
  return (
    <div className={styles.page}>
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
      <h1 className={styles.title}>Живой диалог</h1>
      <p className={styles.intro}>
        Голосовая практика: задай тему — AI спрашивает голосом, ты отвечаешь, удерживая кнопку.
        Грубые ошибки разбираем на ходу, а лог ответов влияет на следующие диалоги.
      </p>
      <LiveDialogueApp />
    </div>
  );
}
