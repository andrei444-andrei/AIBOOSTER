import Link from "next/link";
import { Card } from "@/components/ui";
import { MODULES } from "@/lib/modules";

export default function Home() {
  // Все pinned-модули кроме самой Главной, чтобы не плодить ссылку на текущий экран.
  const entryCards = MODULES.filter((m) => m.pinned && m.slug !== "home");

  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "96px 32px 64px" }}>
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
      <h1
        style={{
          fontSize: 40,
          lineHeight: 1.15,
          marginBottom: 16,
          letterSpacing: "-0.02em",
          maxWidth: 720,
        }}
      >
        Ускоренное решение задач с&nbsp;помощью AI в&nbsp;несколько шагов.
      </h1>
      <p
        style={{
          fontSize: "var(--text-md)",
          color: "var(--text-secondary)",
          maxWidth: 600,
          marginBottom: 40,
        }}
      >
        Сейчас в&nbsp;продукте — фундамент: UX&nbsp;Kit, единый сток ошибок,
        самопровижинящаяся БД, шлюз AIMLAPI. Дальше — реальные модули.
      </p>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 16,
        }}
      >
        {entryCards.map((m) => (
          <Link
            key={m.slug}
            href={m.href}
            style={{ textDecoration: "none", color: "inherit" }}
            aria-label={`${m.title} — ${m.description ?? ""}`}
          >
            <Card
              as="div"
              interactive
              padded
              style={{ height: "100%", minHeight: 110 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 8,
                }}
              >
                {m.icon ? (
                  <span
                    aria-hidden
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "var(--radius-sm)",
                      background: "var(--bg-subtle)",
                      border: "1px solid var(--border)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {m.icon}
                  </span>
                ) : null}
                <strong style={{ fontSize: "var(--text-md)" }}>{m.title}</strong>
                {m.requiresAdminToken ? (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 10,
                      color: "var(--text-muted)",
                      border: "1px solid var(--border)",
                      padding: "0 5px",
                      borderRadius: 4,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    token
                  </span>
                ) : null}
              </div>
              {m.description ? (
                <p
                  style={{
                    color: "var(--text-secondary)",
                    fontSize: "var(--text-sm)",
                    margin: 0,
                  }}
                >
                  {m.description}
                </p>
              ) : null}
            </Card>
          </Link>
        ))}
      </section>
    </main>
  );
}
