export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "96px 32px 64px" }}>
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
        самопровижинящаяся БД, шлюз AIMLAPI. Модули — в&nbsp;боковом меню слева.
      </p>
    </main>
  );
}
