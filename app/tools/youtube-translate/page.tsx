import Link from "next/link";
import Library from "./Library";
import TranslateForm from "./TranslateForm";

export const dynamic = "force-dynamic";

export default function YoutubeTranslatePage() {
  return (
    <div
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "32px 32px 64px",
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
          marginBottom: 6,
        }}
      >
        YouTube → подкаст на твоём языке
      </h1>
      <p
        style={{
          fontSize: "var(--text-md)",
          color: "var(--text-secondary)",
          lineHeight: "var(--leading-relaxed)",
          marginTop: 0,
          marginBottom: 24,
          maxWidth: 720,
        }}
      >
        Добавь видео в подключённый YouTube-плейлист — сервис подхватит его и
        переведёт автоматически. Или вставь ссылку руками — переведём прямо
        сейчас.
      </p>

      <details
        style={{
          marginBottom: 24,
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
          marginTop: 40,
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
