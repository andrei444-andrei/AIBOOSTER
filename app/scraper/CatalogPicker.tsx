"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui";

interface ExamplePrompt {
  label: string;
  prompt: string;
}

interface CatalogItem {
  apify_actor_id: string;
  title_ru: string | null;
  title: string;
  description_ru: string | null;
  category_ru: string | null;
  target_sites: string[];
  example_prompts: ExamplePrompt[];
  stats_users: number | null;
  apify_url: string;
}

interface CategoryAggregate {
  category_ru: string;
  count: number;
}

interface CatalogResponse {
  categories: CategoryAggregate[];
  items: CatalogItem[];
}

/** Триггерит prefill в ScraperLauncher через CustomEvent. */
function dispatchPrefill(prompt: string) {
  window.dispatchEvent(
    new CustomEvent("scraper:prefill", { detail: { prompt } }),
  );
}

export function CatalogPicker() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/scraper/catalog?limit=200")
      .then((r) => r.json())
      .then((d: CatalogResponse | { error?: unknown }) => {
        if (cancelled) return;
        if ("error" in d) {
          setData({ categories: [], items: [] });
        } else {
          setData(d as CatalogResponse);
        }
      })
      .catch(() => {
        if (!cancelled) setData({ categories: [], items: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    if (!activeCategory) return data.items;
    return data.items.filter((i) => i.category_ru === activeCategory);
  }, [data, activeCategory]);

  if (loading) {
    return (
      <section style={{ marginBottom: 32 }}>
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: "var(--text-sm)",
            padding: "12px 0",
          }}
        >
          Загружаю каталог идей…
        </div>
      </section>
    );
  }

  if (!data || data.items.length === 0) {
    // Каталог не наполнен — секцию просто не показываем, без шума.
    return null;
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ fontSize: "var(--text-lg)", margin: 0 }}>
          Что я умею
        </h2>
        <span style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
          Клик по карточке — пред-заполнит форму примером
        </span>
      </div>

      {/* Категории */}
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <CategoryChip
          label="Все"
          count={data.items.length}
          active={!activeCategory}
          onClick={() => setActiveCategory(null)}
        />
        {data.categories.map((c) => (
          <CategoryChip
            key={c.category_ru}
            label={c.category_ru}
            count={c.count}
            active={activeCategory === c.category_ru}
            onClick={() => setActiveCategory(c.category_ru)}
          />
        ))}
      </div>

      {/* Карточки */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        {filteredItems.slice(0, 30).map((item) => (
          <CatalogCard key={item.apify_actor_id} item={item} />
        ))}
      </div>
    </section>
  );
}

function CategoryChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "4px 10px",
        fontSize: "var(--text-sm)",
        border: `1px solid ${active ? "var(--text-primary)" : "var(--border)"}`,
        borderRadius: "var(--radius-sm)",
        background: active ? "var(--text-primary)" : "transparent",
        color: active ? "var(--bg)" : "var(--text-secondary)",
        cursor: "pointer",
      }}
    >
      {label}
      <span
        style={{
          marginLeft: 6,
          opacity: 0.7,
          fontSize: "var(--text-xs, 11px)",
        }}
      >
        {count}
      </span>
    </button>
  );
}

function CatalogCard({ item }: { item: CatalogItem }) {
  const title = item.title_ru || item.title;
  const desc = item.description_ru || "";
  const sites = item.target_sites?.slice(0, 3) ?? [];

  return (
    <Card padded as="div" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: "var(--text-md)", display: "block" }}>
          {title}
        </strong>
        {item.category_ru ? (
          <span
            style={{
              fontSize: "var(--text-xs, 11px)",
              color: "var(--text-muted)",
            }}
          >
            {item.category_ru}
          </span>
        ) : null}
      </div>
      {desc ? (
        <p
          style={{
            margin: "0 0 10px",
            color: "var(--text-secondary)",
            fontSize: "var(--text-sm)",
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {desc}
        </p>
      ) : null}
      {sites.length > 0 ? (
        <div
          style={{
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
            marginBottom: 10,
          }}
        >
          {sites.map((s) => (
            <span
              key={s}
              style={{
                padding: "1px 6px",
                fontSize: 11,
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
                borderRadius: 3,
              }}
            >
              {s}
            </span>
          ))}
        </div>
      ) : null}
      <div
        style={{
          marginTop: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {item.example_prompts.slice(0, 2).map((ex, i) => (
          <button
            key={i}
            type="button"
            onClick={() => dispatchPrefill(ex.prompt)}
            title={ex.prompt}
            style={{
              textAlign: "left",
              background: "transparent",
              border: "1px dashed var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "6px 8px",
              fontSize: "var(--text-sm)",
              color: "var(--text-secondary)",
              cursor: "pointer",
              lineHeight: 1.3,
            }}
          >
            → {ex.label}
          </button>
        ))}
      </div>
    </Card>
  );
}
