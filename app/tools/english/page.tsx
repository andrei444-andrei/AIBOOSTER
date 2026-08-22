import Link from "next/link";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

// Хаб модуля «Английский». Пока один подраздел — «Генерируемые диалоги».
// Дальше сюда добавляются новые карточки (новые подразделы обучения).
interface SubsectionDef {
  slug: string;
  title: string;
  description: string;
  href: string;
  status: "live" | "soon";
}

const SUBSECTIONS: SubsectionDef[] = [
  {
    slug: "dialogues",
    title: "Генерируемые диалоги",
    description:
      "Тема → AI пишет и озвучивает разговор на английском. Длительность, диалог/монолог, перевод. Слушаешь как подкаст с резюмом и «Завершёнными».",
    href: "/tools/english/dialogues",
    status: "live",
  },
  {
    slug: "build-sentences",
    title: "Build sentences",
    description:
      "Тема → 10 предложений. Собери каждое из кусков в правильном порядке: перетаскивай, тапай для перевода, при ошибке — памятка по структуре. Разделы «Надо сделать»/«Сделано».",
    href: "/tools/english/build-sentences",
    status: "live",
  },
  {
    slug: "live-dialogue",
    title: "Живой диалог",
    description:
      "Голосовая практика: AI спрашивает голосом, ты отвечаешь, удерживая кнопку. «Помощь» подскажет фразу, грубые ошибки разбираются на ходу. Мобайл-фёрст.",
    href: "/tools/english/live-dialogue",
    status: "live",
  },
];

export default function EnglishHubPage() {
  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "var(--space-8) var(--space-8) var(--space-16)" }}>
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
      <h1 style={{ fontSize: 32, letterSpacing: "-0.02em", marginTop: "var(--space-5)", marginBottom: "var(--space-2)" }}>
        Английский
      </h1>
      <p
        style={{
          fontSize: "var(--text-md)",
          color: "var(--text-secondary)",
          lineHeight: "var(--leading-relaxed)",
          margin: "0 0 var(--space-6)",
          maxWidth: 720,
        }}
      >
        Модуль для практики английского языка. Выбери подраздел.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "var(--space-4)",
        }}
      >
        {SUBSECTIONS.map((s) => {
          const card = (
            <Card as="div" interactive={s.status === "live"} padded style={{ height: "100%", minHeight: 120 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <strong style={{ fontSize: "var(--text-md)" }}>{s.title}</strong>
                {s.status === "soon" && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      padding: "2px 8px",
                      borderRadius: 999,
                      color: "var(--text-muted)",
                      background: "var(--bg-subtle)",
                    }}
                  >
                    скоро
                  </span>
                )}
              </div>
              <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", margin: 0, lineHeight: 1.5 }}>
                {s.description}
              </p>
            </Card>
          );
          return s.status === "live" ? (
            <Link key={s.slug} href={s.href} style={{ textDecoration: "none", color: "inherit" }}>
              {card}
            </Link>
          ) : (
            <div key={s.slug}>{card}</div>
          );
        })}
      </div>
    </main>
  );
}
