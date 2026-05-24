import TranslateForm from "./TranslateForm";

export const dynamic = "force-dynamic";

const wrap: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: "48px 24px" };

export default function YoutubeTranslatePage() {
  return (
    <main style={wrap}>
      <a href="/" style={{ color: "#79b8ff", fontSize: 13, textDecoration: "none" }}>
        ← к списку инструментов
      </a>
      <h1 style={{ fontSize: 32, marginTop: 16, marginBottom: 8 }}>
        Перевод YouTube-видео
      </h1>
      <p style={{ fontSize: 16, opacity: 0.75, lineHeight: 1.5, marginTop: 0 }}>
        Вставь ссылку — выбери язык — получи переведённую озвучку, которую можно
        слушать прямо в браузере. До 60 минут.
      </p>

      <TranslateForm />

      <div style={{ marginTop: 32, fontSize: 13, opacity: 0.55, lineHeight: 1.6 }}>
        <div>
          Под капотом: распознаём речь (Whisper), переводим (GPT/Claude),
          озвучиваем (ElevenLabs multilingual v2). Все модели — через aimlapi.
        </div>
        <div style={{ marginTop: 6 }}>
          Обработка часового видео занимает 5–15 минут. Можно закрыть вкладку —
          у задачи есть постоянная ссылка, вернёшься по ней.
        </div>
      </div>
    </main>
  );
}
