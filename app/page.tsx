export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ fontSize: 40, marginBottom: 8 }}>AIBOOSTER</h1>
      <p style={{ fontSize: 18, opacity: 0.8, lineHeight: 1.5 }}>
        Ускоренное решение задач с помощью AI в несколько шагов.
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
