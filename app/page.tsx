export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ fontSize: 40, marginBottom: 8 }}>AIBOOSTER</h1>
      <p style={{ fontSize: 18, opacity: 0.8, lineHeight: 1.5 }}>
        Ускоренное решение задач с помощью AI в несколько шагов.
      </p>
      <p style={{ marginTop: 24 }}>
        <a
          href="/ads"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 20px",
            background: "linear-gradient(135deg,#8b7bff,#6d5dfc)",
            color: "#fff",
            borderRadius: 12,
            fontWeight: 700,
            textDecoration: "none",
            boxShadow: "0 8px 20px rgba(109,93,252,.35)",
          }}
        >
          ✦ Прототип: конструктор объявлений →
        </a>
      </p>
      <p style={{ marginTop: 32, opacity: 0.6 }}>
        Статус: инициализация проекта. Служебная панель —{" "}
        <code style={{ background: "#1a1e24", padding: "2px 6px", borderRadius: 4 }}>
          /admin
        </code>{" "}
        (под токеном).
      </p>
    </main>
  );
}
