import Link from "next/link";
import GenerateForm from "./GenerateForm";
import Library from "./Library";
import styles from "./english.module.css";

export const dynamic = "force-dynamic";

export default function EnglishDialoguesPage() {
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
      <h1 className={styles.libraryTitle}>Генерируемые диалоги</h1>
      <p className={styles.libraryIntro}>
        Напиши тему — AI сочинит разговор на английском и озвучит его. Выбери
        длительность, тип (диалог или монолог) и нужен ли перевод. Готовые
        разговоры слушаются как подкаст: продолжаем с той секунды, на которой
        остановились, а дослушанные уезжают в «Завершённые».
      </p>

      <div style={{ marginBottom: "var(--space-8)" }}>
        <GenerateForm />
      </div>

      <Library />

      <p
        style={{
          marginTop: "var(--space-10)",
          fontSize: "var(--text-sm)",
          color: "var(--text-muted)",
          lineHeight: "var(--leading-relaxed)",
        }}
      >
        Под капотом: сценарий пишет LLM через AIMLAPI, озвучка — ElevenLabs{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>eleven_multilingual_v2</code>,
        склейка в один mp3 через ffmpeg, файл хранится в Cloudflare R2.
      </p>
    </div>
  );
}
