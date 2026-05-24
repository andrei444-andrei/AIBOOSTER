const wrap: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: "64px 24px" };
const toolCard: React.CSSProperties = {
  display: "block",
  background: "#12161c",
  border: "1px solid #232a33",
  borderRadius: 10,
  padding: 20,
  marginTop: 16,
  color: "#e6e8eb",
  textDecoration: "none",
};

export default function Home() {
  return (
    <main style={wrap}>
      <h1 style={{ fontSize: 40, marginBottom: 8 }}>AIBOOSTER</h1>
      <p style={{ fontSize: 18, opacity: 0.8, lineHeight: 1.5 }}>
        Ускоренное решение задач с помощью AI в несколько шагов.
      </p>

      <h2 style={{ fontSize: 18, marginTop: 40, marginBottom: 8, opacity: 0.7 }}>
        Инструменты
      </h2>

      <a href="/tools/youtube-translate" style={toolCard}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Перевод YouTube-видео →</div>
        <div style={{ opacity: 0.65, fontSize: 14, marginTop: 6 }}>
          Вставь ссылку, выбери язык — получи переведённую озвучку с транскриптом.
        </div>
      </a>

      <p style={{ marginTop: 40, opacity: 0.5, fontSize: 13 }}>
        Служебная панель —{" "}
        <code style={{ background: "#1a1e24", padding: "2px 6px", borderRadius: 4 }}>
          /admin
        </code>{" "}
        (под токеном).
      </p>
    </main>
  );
}
