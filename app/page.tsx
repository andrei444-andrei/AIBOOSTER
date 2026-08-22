import Link from "next/link";
import { Card } from "@/components/ui";
import { MODULES } from "@/lib/modules";
import { checkAdminTokenValue } from "@/lib/auth";
import { listSources } from "@/lib/adapters/sources";
import { getContextStats } from "@/lib/adapters/stats";
import type { AdapterKind, AdapterSourceRow } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SP = Record<string, string | string[] | undefined>;

function pickStr(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

interface IntegrationDef {
  kind: AdapterKind;
  title: string;
  description: string;
  status: "live" | "soon";
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    kind: "gmail",
    title: "Gmail",
    description: "Письма из инбокса, инкрементально каждые 2 мин.",
    status: "live",
  },
  {
    kind: "gcal",
    title: "Google Calendar",
    description: "События календаря, тот же Google-аккаунт.",
    status: "soon",
  },
  {
    kind: "telegram",
    title: "Telegram",
    description: "Сообщения, отправленные боту.",
    status: "soon",
  },
  {
    kind: "notion",
    title: "Notion",
    description: "Страницы workspace через Integration Token.",
    status: "soon",
  },
  {
    kind: "slack",
    title: "Slack",
    description: "Сообщения в каналах и DM.",
    status: "soon",
  },
];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const token = pickStr(sp.token) ?? "";
  const tokenAuthed = checkAdminTokenValue(token).ok;

  // Все pinned-модули кроме самой Главной и Источников — последние уже выведены
  // отдельной секцией выше, незачем дублировать карточкой.
  const entryCards = MODULES.filter(
    (m) => m.pinned && m.slug !== "home" && m.slug !== "adapters",
  );

  let sources: AdapterSourceRow[] = [];
  let stats: Awaited<ReturnType<typeof getContextStats>> = {
    total: 0,
    last24h: 0,
    bySource: {},
  };
  if (tokenAuthed) {
    try {
      sources = await listSources();
    } catch {
      // не критично — секция отрендерится без данных
    }
    stats = await getContextStats();
  }
  const sourcesByKind: Partial<Record<AdapterKind, AdapterSourceRow>> = {};
  for (const s of sources) sourcesByKind[s.kind] = s;

  const adapterHref = tokenAuthed
    ? `/admin/adapters?token=${encodeURIComponent(token)}`
    : "/admin/adapters";

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
          marginBottom: 56,
        }}
      >
        Сейчас в&nbsp;продукте — фундамент: UX&nbsp;Kit, единый сток ошибок,
        самопровижинящаяся БД, шлюз AIMLAPI. Дальше — реальные модули.
      </p>

      {/* === Источники контекста === */}
      <section style={{ marginBottom: 48 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 16,
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <h2
            style={{
              fontSize: 22,
              letterSpacing: "-0.01em",
              margin: 0,
            }}
          >
            Источники контекста
          </h2>
          <Link
            href={adapterHref}
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--text-secondary)",
              textDecoration: "none",
              borderBottom: "1px solid var(--border)",
            }}
          >
            Управлять →
          </Link>
        </div>

        {tokenAuthed && (
          <div
            style={{
              display: "flex",
              gap: 24,
              padding: "12px 16px",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              marginBottom: 16,
              flexWrap: "wrap",
            }}
          >
            <HomeStat
              label="В контексте"
              value={fmtNum(stats.total)}
              unit="сниппетов"
            />
            <HomeStat
              label="За 24 часа"
              value={`+${fmtNum(stats.last24h)}`}
              unit="новых"
            />
            <HomeStat
              label="Активных источников"
              value={String(
                sources.filter(
                  (s) => !!s.credentials && s.status !== "disabled",
                ).length,
              )}
              unit={`из ${INTEGRATIONS.length}`}
            />
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          {INTEGRATIONS.map((integ) => {
            const src = sourcesByKind[integ.kind];
            const connected = tokenAuthed && !!src && !!src.credentials;
            const s = stats.bySource[integ.kind];

            let badge: { label: string; color: string; bg: string };
            if (integ.status === "soon") {
              badge = {
                label: "скоро",
                color: "var(--text-muted)",
                bg: "var(--bg-subtle)",
              };
            } else if (!tokenAuthed) {
              badge = {
                label: "доступен",
                color: "var(--text-secondary)",
                bg: "var(--bg-subtle)",
              };
            } else if (!connected) {
              badge = {
                label: "не подключён",
                color: "var(--text-muted)",
                bg: "var(--bg-subtle)",
              };
            } else if (src!.status === "error") {
              badge = {
                label: "ошибка",
                color: "var(--danger)",
                bg: "var(--danger-bg)",
              };
            } else if (src!.status === "syncing") {
              badge = {
                label: "синкается",
                color: "var(--warning)",
                bg: "var(--warning-bg)",
              };
            } else if (src!.status === "disabled") {
              badge = {
                label: "выкл",
                color: "var(--text-muted)",
                bg: "var(--bg-subtle)",
              };
            } else {
              badge = {
                label: "подключён",
                color: "var(--success)",
                bg: "var(--success-bg)",
              };
            }

            return (
              <Link
                key={integ.kind}
                href={adapterHref}
                style={{ textDecoration: "none", color: "inherit" }}
                aria-label={`${integ.title} — ${integ.description}`}
              >
                <Card
                  as="div"
                  interactive={integ.status === "live"}
                  padded
                  style={{ height: "100%", minHeight: 120 }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <strong style={{ fontSize: "var(--text-md)" }}>
                      {integ.title}
                    </strong>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        padding: "2px 8px",
                        borderRadius: 999,
                        color: badge.color,
                        background: badge.bg,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <p
                    style={{
                      color: "var(--text-secondary)",
                      fontSize: "var(--text-sm)",
                      margin: 0,
                      lineHeight: 1.5,
                    }}
                  >
                    {integ.description}
                  </p>
                  {connected && s && (
                    <div
                      style={{
                        marginTop: 10,
                        paddingTop: 10,
                        borderTop: "1px solid var(--border)",
                        fontSize: 12,
                        color: "var(--text-muted)",
                      }}
                    >
                      сохранено:{" "}
                      <strong
                        style={{ color: "var(--text)", fontWeight: 600 }}
                      >
                        {fmtNum(s.total)}
                      </strong>
                      {s.last24h > 0 && (
                        <span style={{ color: "var(--success)" }}>
                          {" · за 24ч +"}
                          {fmtNum(s.last24h)}
                        </span>
                      )}
                    </div>
                  )}
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      {/* === Модули продукта === */}
      <section style={{ marginBottom: 12 }}>
        <h2
          style={{
            fontSize: 22,
            letterSpacing: "-0.01em",
            marginBottom: 16,
          }}
        >
          Модули
        </h2>
        <div
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
                  <strong style={{ fontSize: "var(--text-md)" }}>
                    {m.title}
                  </strong>
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
        </div>
      </section>
    </main>
  );
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("ru-RU").format(n);
}

function HomeStat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.2 }}>
        {value}
        {unit && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 400,
              color: "var(--text-muted)",
              marginLeft: 6,
            }}
          >
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}
