import Link from "next/link";
import Library from "./Library";
import TranslateForm from "./TranslateForm";
import styles from "./youtube.module.css";

export const dynamic = "force-dynamic";

export default function YoutubeTranslatePage() {
  return (
    <div className={styles.libraryPage}>
      <Link
        href="/"
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--text-secondary)",
          textDecoration: "none",
          borderBottom: "1px solid var(--border)",
        }}
      >
        ← на главную
      </Link>
      <h1 className={styles.libraryTitle}>YouTube → подкаст на твоём языке</h1>
      <p className={styles.libraryIntro}>
        Привяжи публичный YouTube-плейлист — сервис каждую минуту смотрит
        новые видео и автоматом ставит в очередь на перевод. Или вставь
        ссылку руками — переведём прямо сейчас.
      </p>

      <details
        style={{
          marginBottom: "var(--space-5)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
      >
        <summary
          style={{
            padding: "12px 16px",
            cursor: "pointer",
            fontSize: "var(--text-base)",
            color: "var(--text-secondary)",
            listStyle: "none",
          }}
        >
          + добавить видео руками
        </summary>
        <div style={{ padding: "0 16px 16px" }}>
          <TranslateForm />
        </div>
      </details>

      <Library />

      <p
        style={{
          marginTop: "var(--space-10)",
          fontSize: "var(--text-sm)",
          color: "var(--text-muted)",
          lineHeight: "var(--leading-relaxed)",
        }}
      >
        Под капотом: транскрипт через Apify, перевод gpt-4o на уровне абзацев,
        озвучка ElevenLabs{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>
          eleven_multilingual_v2
        </code>
        . Плейлист опрашивается через RSS-фид раз в минуту, новые видео
        автоматом ставятся в очередь.
      </p>
    </div>
  );
}
