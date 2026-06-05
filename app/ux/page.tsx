"use client";

import { useState } from "react";
import {
  Button,
  Input,
  Textarea,
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Modal,
  Form,
  FormRow,
  FormActions,
  useToast,
} from "@/components/ui";

export default function UxKitPage() {
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) {
      setEmailError("Похоже, это не email");
      return;
    }
    setEmailError("");
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      toast.success({
        title: "Форма отправлена",
        message: `Привет, ${name || "друг"}. Заявка от ${email} принята.`,
      });
      setName("");
      setEmail("");
    }, 900);
  }

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "48px 24px 96px" }}>
      <header style={{ marginBottom: 32 }}>
        <p
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 8,
          }}
        >
          UX Kit · §3 конституции
        </p>
        <h1 style={{ marginBottom: 12 }}>AIBOOSTER · кит</h1>
        <p style={{ color: "var(--text-secondary)", maxWidth: 640 }}>
          Базовый набор компонентов и токенов. Дальше во всех разделах
          используем это, новые компоненты не плодим без необходимости.
          Тема — светлая, шрифт Geist, акцент графит, скругление 8&nbsp;px.
        </p>
      </header>

      <Section title="Buttons" subtitle="Variants · sizes · loading state">
        <Row>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
        </Row>
        <Row>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </Row>
        <Row>
          <Button loading>Sending…</Button>
          <Button disabled>Disabled</Button>
          <Button variant="secondary" leadingIcon={<span>↗</span>}>
            With icon
          </Button>
        </Row>
      </Section>

      <Section title="Inputs" subtitle="Label · helper · error · disabled">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 720 }}>
          <Input label="Имя" placeholder="Например, Андрей" />
          <Input
            label="Email"
            placeholder="you@example.com"
            type="email"
            helperText="Используем для уведомлений."
          />
          <Input label="С ошибкой" defaultValue="not-an-email" errorText="Похоже, это не email" />
          <Input label="Отключено" defaultValue="Нельзя редактировать" disabled />
          <div style={{ gridColumn: "1 / -1" }}>
            <Textarea
              label="Заметка"
              placeholder="Что хочешь сказать?"
              helperText="Поддерживает многострочный ввод."
              rows={4}
            />
          </div>
        </div>
      </Section>

      <Section title="Cards" subtitle="Container · interactive · header/body/footer">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Card>
            <strong>Базовая карточка</strong>
            <p style={{ color: "var(--text-secondary)", marginTop: 6, fontSize: "var(--text-sm)" }}>
              Просто контейнер с границей, паддингом и скруглением. Подходит
              для секций и любых блоков контента.
            </p>
          </Card>

          <Card interactive onClick={() => toast.info({ title: "Клик по карточке" })}>
            <strong>Кликабельная карточка</strong>
            <p style={{ color: "var(--text-secondary)", marginTop: 6, fontSize: "var(--text-sm)" }}>
              Hover, focus, keyboard — нажми Enter или Space когда наведёшь.
            </p>
          </Card>

          <Card padded={false} style={{ gridColumn: "1 / -1" }}>
            <CardHeader
              title="Карточка с заголовком и подвалом"
              subtitle="Идеально для разделов настроек или диалогов."
              actions={<Button size="sm" variant="ghost">Действие</Button>}
            />
            <CardBody>
              <p style={{ color: "var(--text-secondary)" }}>
                Body растёт по содержимому. Header и Footer фиксированные,
                между ними тонкая граница.
              </p>
            </CardBody>
            <CardFooter>
              <span style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
                Подвал — для метаданных или вторичных действий.
              </span>
            </CardFooter>
          </Card>
        </div>
      </Section>

      <Section title="Modal" subtitle="Esc / клик по фону / крестик — закрывают">
        <Row>
          <Button onClick={() => setModalOpen(true)}>Открыть Modal</Button>
          <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
            Подтверждение
          </Button>
        </Row>

        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Пример модалки"
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                Отмена
              </Button>
              <Button
                onClick={() => {
                  setModalOpen(false);
                  toast.success({ title: "Сохранено" });
                }}
              >
                Сохранить
              </Button>
            </>
          }
        >
          <p style={{ color: "var(--text-secondary)" }}>
            Модалка с заголовком, телом и футером. Закрывается на{" "}
            <code>Esc</code>, клик по подложке и крестик.
          </p>
        </Modal>

        <Modal
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title="Удалить запись?"
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                Отмена
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirmOpen(false);
                  toast.error({ title: "Запись удалена", message: "Это нельзя отменить." });
                }}
              >
                Удалить
              </Button>
            </>
          }
        >
          <p style={{ color: "var(--text-secondary)" }}>
            Это деструктивное действие. Откатить будет нельзя.
          </p>
        </Modal>
      </Section>

      <Section title="Form" subtitle="Form · FormRow · FormActions">
        <Card padded>
          <Form onSubmit={onSubmit}>
            <FormRow>
              <Input
                label="Имя"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Андрей"
              />
              <Input
                label="Email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                errorText={emailError || undefined}
                placeholder="you@example.com"
              />
            </FormRow>
            <Textarea label="Сообщение" placeholder="Что нужно?" rows={3} />
            <FormActions>
              <Button variant="ghost" type="reset" onClick={() => { setName(""); setEmail(""); setEmailError(""); }}>
                Очистить
              </Button>
              <Button type="submit" loading={loading}>
                Отправить
              </Button>
            </FormActions>
          </Form>
        </Card>
      </Section>

      <Section title="Toast" subtitle="4 типа · авто-закрытие 4s · кнопка закрыть">
        <Row>
          <Button
            variant="secondary"
            onClick={() =>
              toast.info({ title: "Info", message: "Просто информационное уведомление." })
            }
          >
            Info
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast.success({ title: "Success", message: "Всё прошло хорошо." })
            }
          >
            Success
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast.warning({ title: "Warning", message: "Стоит обратить внимание." })
            }
          >
            Warning
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast.error({ title: "Error", message: "Что-то пошло не так." })
            }
          >
            Error
          </Button>
        </Row>
      </Section>

      <Section
        title="Навигация"
        subtitle="Sidebar слева ← смотри на него сейчас · единый реестр модулей"
      >
        <Card padded>
          <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
            Слева — постоянный <code>Sidebar</code> (компонент UX&nbsp;Kit). Включает
            бренд, активный пункт, разделы main/service и чип <code>token</code> для
            защищённых страниц. Появляется на каждой странице через{" "}
            <code>AppShell</code> в <code>app/layout.tsx</code>.
          </p>
          <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
            Единый источник правды — <code>lib/modules.ts</code>. Новый модуль =
            одна запись в реестре. Sidebar и любой будущий «индекс модулей»
            читают одно и то же.
          </p>
          <pre
            style={{
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: 12,
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              overflowX: "auto",
              margin: 0,
            }}
          >
{`// lib/modules.ts
export const MODULES: ModuleEntry[] = [
  { slug: "home",   title: "Главная", href: "/",     section: "main",    pinned: true, icon: "·" },
  { slug: "ux-kit", title: "UX Kit",  href: "/ux",   section: "service", pinned: true, icon: "◐" },
  { slug: "admin",  title: "Админка", href: "/admin", section: "service", pinned: true,
    icon: "⌘", requiresAdminToken: true },
  // ← добавь свой модуль здесь
];`}
          </pre>
        </Card>
      </Section>

      <Section title="Палитра и токены" subtitle="Цвета · типографика · скругления · тени">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <h3 style={{ marginBottom: 12, fontSize: "var(--text-md)" }}>Цвета</h3>
            <Swatches
              items={[
                ["--bg", "Page"],
                ["--bg-subtle", "Subtle"],
                ["--bg-muted", "Muted"],
                ["--text", "Text"],
                ["--text-secondary", "Secondary"],
                ["--text-muted", "Muted"],
                ["--accent", "Accent"],
                ["--success", "Success"],
                ["--warning", "Warning"],
                ["--danger", "Danger"],
                ["--info", "Info"],
              ]}
            />
          </div>
          <div>
            <h3 style={{ marginBottom: 12, fontSize: "var(--text-md)" }}>Типографика</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <p style={{ fontSize: "var(--text-2xl)", fontWeight: 600 }}>Заголовок H1 — 32</p>
              <p style={{ fontSize: "var(--text-xl)", fontWeight: 600 }}>Заголовок H2 — 24</p>
              <p style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>Заголовок H3 — 18</p>
              <p style={{ fontSize: "var(--text-md)" }}>Lead — 15</p>
              <p style={{ fontSize: "var(--text-base)" }}>Body — 14 (default)</p>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                Small — 12 (helpers)
              </p>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}>
                Mono — Geist Mono для кода
              </p>
            </div>
          </div>
        </div>
      </Section>

      <footer style={{ marginTop: 64, color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
        Документ живой. Новые компоненты добавляются сюда после согласования.
      </footer>
    </main>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 48 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ marginBottom: 4 }}>{title}</h2>
        {subtitle ? (
          <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{subtitle}</p>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>{children}</div>;
}

function Swatches({ items }: { items: Array<[string, string]> }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {items.map(([token, name]) => (
        <div
          key={token}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: 8,
            background: "var(--bg)",
          }}
        >
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: `var(${token})`,
              flexShrink: 0,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>{name}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
              {token}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
