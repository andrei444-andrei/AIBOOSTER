import Link from "next/link";

export default function Home() {
  return (
    <div style={{ maxWidth: 720, margin: "64px auto 32px" }}>
      <p
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 12,
        }}
      >
        AIBOOSTER
      </p>
      <h1 style={{ fontSize: 40, lineHeight: 1.15, marginBottom: 16, letterSpacing: "-0.02em" }}>
        Ускоренное решение задач с&nbsp;помощью AI в&nbsp;несколько шагов.
      </h1>
      <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", maxWidth: 560 }}>
        Первый модуль продукта — AI&nbsp;Chat: переключение моделей, файлы,
        markdown с таблицами и форматированием.
      </p>

      <div
        style={{
          marginTop: 40,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          maxWidth: 560,
        }}
      >
        <Link
          href="/chat"
          style={{
            display: "block",
            padding: 20,
            border: "1px solid var(--accent)",
            borderRadius: "var(--radius-lg)",
            background: "var(--accent)",
            color: "var(--text-on-accent)",
            textDecoration: "none",
            gridColumn: "1 / -1",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: "var(--text-lg)" }}>AI Chat →</div>
          <div style={{ fontSize: "var(--text-sm)", opacity: 0.85 }}>
            Чат с переключением между топовыми моделями. Прикрепляйте файлы и картинки.
          </div>
        </Link>
        <Link
          href="/ux"
          style={{
            display: "block",
            padding: 16,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            background: "var(--bg)",
            textDecoration: "none",
            color: "var(--text)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>UX Kit</div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            Палитра, типографика, базовые компоненты.
          </div>
        </Link>
        <Link
          href="/admin"
          style={{
            display: "block",
            padding: 16,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            background: "var(--bg)",
            textDecoration: "none",
            color: "var(--text)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Админка</div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            Структура БД и логи (под токеном).
          </div>
        </Link>
      </div>
    </div>
  );
}
