import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "96px 24px 64px" }}>
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
        Сейчас в&nbsp;продукте — фундамент: UX&nbsp;Kit, единый сток ошибок,
        самопровижинящаяся БД. Дальше будут реальные сценарии.
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
    </main>
  );
}
