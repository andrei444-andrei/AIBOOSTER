import Link from "next/link";
import HistoryPanel from "./HistoryPanel";
import TranslateForm from "./TranslateForm";

export const dynamic = "force-dynamic";

export default function YoutubeTranslatePage() {
  return (
    <div
      style={{
        display: "flex",
        gap: 32,
        maxWidth: 1100,
        margin: "0 auto",
        padding: "0 32px",
      }}
    >
      <HistoryPanel />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          maxWidth: 720,
          padding: "32px 0 64px",
        }}
      >
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
        <h1
          style={{
            fontSize: 32,
            letterSpacing: "-0.02em",
            marginTop: 20,
            marginBottom: 12,
          }}
        >
          Перевод YouTube-видео
        </h1>
        <p
          style={{
            fontSize: "var(--text-md)",
            color: "var(--text-secondary)",
            lineHeight: "var(--leading-relaxed)",
            marginTop: 0,
            marginBottom: 32,
          }}
        >
          Вставь ссылку — выбери язык — получи переведённую озвучку, которую можно
          слушать прямо в браузере. До 60 минут.
        </p>

        <TranslateForm />

        <p
          style={{
            marginTop: 40,
            fontSize: "var(--text-sm)",
            color: "var(--text-muted)",
            lineHeight: "var(--leading-relaxed)",
          }}
        >
          Под капотом: транскрипт через Apify, перевод gpt-4o, озвучка
          ElevenLabs{" "}
          <code style={{ fontFamily: "var(--font-mono)" }}>
            eleven_multilingual_v2
          </code>
          . Видео без YouTube-субтитров не поддерживаются.
        </p>
      </main>
    </div>
  );
}
