// Mock data + helpers for the Ad Creation Studio prototype.
// Everything here is self-contained so the prototype works without a backend.

export type Format = { id: string; label: string; w: number; h: number };
export type TextReq = {
  key: string;
  label: string;
  max: number;
  min?: number;
  kind: "title" | "desc";
  hint?: string;
};
export type Network = {
  id: string;
  name: string;
  short: string;
  color: string;
  formats: Format[];
  texts: TextReq[];
};
export type Campaign = {
  id: string;
  name: string;
  net: string;
  geo: string;
  status: "active" | "draft" | "paused";
};

export const NETWORKS: Network[] = [
  {
    id: "push",
    name: "Push.House",
    short: "PH",
    color: "#7c5cff",
    formats: [
      { id: "icon", label: "Иконка", w: 192, h: 192 },
      { id: "image", label: "Баннер", w: 360, h: 240 },
    ],
    texts: [
      { key: "title", label: "Заголовок", max: 30, kind: "title", hint: "Цепляющий, до 30 символов" },
      { key: "desc", label: "Текст", max: 45, kind: "desc", hint: "Краткое описание, до 45" },
    ],
  },
  {
    id: "propeller",
    name: "PropellerAds",
    short: "PR",
    color: "#f59e0b",
    formats: [
      { id: "rect", label: "300×250", w: 300, h: 250 },
      { id: "wide", label: "728×90", w: 728, h: 90 },
    ],
    texts: [
      { key: "title", label: "Заголовок", max: 32, kind: "title" },
      { key: "brand", label: "Бренд", max: 25, kind: "title" },
      { key: "desc", label: "Описание", max: 90, kind: "desc" },
    ],
  },
  {
    id: "mytarget",
    name: "MyTarget",
    short: "MT",
    color: "#16c2a3",
    formats: [
      { id: "feed", label: "1080×607", w: 1080, h: 607 },
      { id: "square", label: "600×600", w: 600, h: 600 },
    ],
    texts: [
      { key: "title", label: "Заголовок", max: 25, kind: "title" },
      { key: "desc", label: "Текст", max: 90, kind: "desc" },
    ],
  },
  {
    id: "tiktok",
    name: "TikTok Ads",
    short: "TT",
    color: "#ec4899",
    formats: [
      { id: "story", label: "1080×1920", w: 1080, h: 1920 },
      { id: "square", label: "1080×1080", w: 1080, h: 1080 },
    ],
    texts: [{ key: "title", label: "Текст объявления", max: 100, kind: "desc" }],
  },
  {
    id: "google",
    name: "Google Display",
    short: "G",
    color: "#34a853",
    formats: [
      { id: "wide", label: "1200×628", w: 1200, h: 628 },
      { id: "square", label: "1080×1080", w: 1080, h: 1080 },
      { id: "story", label: "1080×1920", w: 1080, h: 1920 },
    ],
    texts: [
      { key: "title", label: "Заголовок", max: 30, kind: "title" },
      { key: "long", label: "Длинный заголовок", max: 90, kind: "title" },
      { key: "desc", label: "Описание", max: 90, kind: "desc" },
    ],
  },
];

export const CAMPAIGNS: Campaign[] = [
  { id: "c1", name: "Nike Air — Ретаргет RU", net: "push", geo: "RU", status: "active" },
  { id: "c2", name: "LuxTime Часы — Cold EU", net: "propeller", geo: "EU", status: "active" },
  { id: "c3", name: "FitGo Подписка", net: "mytarget", geo: "CIS", status: "draft" },
  { id: "c4", name: "CryptoPro Native", net: "tiktok", geo: "Tier-1", status: "paused" },
  { id: "c5", name: "Зимняя распродажа 2026", net: "google", geo: "RU", status: "active" },
];

export type Asset = { id: string; title: string; source: string; seed: string };

export const FAVORITES: Asset[] = [
  { id: "f1", title: "Кроссовки Nike", source: "nike.com", seed: "sneaker-77" },
  { id: "f2", title: "Часы premium", source: "pinterest.com", seed: "watch-12" },
  { id: "f3", title: "Зимняя куртка", source: "ozon.ru", seed: "jacket-9" },
  { id: "f4", title: "Смартфон flagship", source: "mvideo.ru", seed: "phone-31" },
  { id: "f5", title: "Утренний кофе", source: "unsplash.com", seed: "coffee-21" },
  { id: "f6", title: "Фитнес-зал", source: "fitgo.app", seed: "gym-5" },
  { id: "f7", title: "Авто премиум", source: "auto.ru", seed: "car-88" },
  { id: "f8", title: "Косметика", source: "goldapple.ru", seed: "beauty-4" },
  { id: "f9", title: "Наушники", source: "dns-shop.ru", seed: "buds-14" },
  { id: "f10", title: "Путешествие", source: "aviasales.ru", seed: "travel-63" },
];

const SEARCH_SOURCES = [
  "avito.ru",
  "ozon.ru",
  "pinterest.com",
  "wildberries.ru",
  "yandex.ru",
  "dzen.ru",
  "vk.com",
  "aliexpress.com",
];

export function searchImages(q: string): Asset[] {
  const base = q.trim() || "creative";
  return Array.from({ length: 12 }, (_, i) => ({
    id: `s_${base}_${i}`,
    title: `${q.trim() || "результат"} ${i + 1}`,
    source: SEARCH_SOURCES[i % SEARCH_SOURCES.length],
    seed: `${base}-${i}-${(base.length * 7 + i * 13) % 97}`,
  }));
}

export function imgUrl(seed: string, size = 600): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${size}/${size}`;
}

export function seedGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  const h2 = (h + 48) % 360;
  return `linear-gradient(135deg, hsl(${h} 72% 64%), hsl(${h2} 70% 46%))`;
}

// ---- Fake "AI" headline generator ---------------------------------------

function fit(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  let cut = clean.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  if (sp >= max * 0.6) cut = cut.slice(0, sp);
  return cut.trim();
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

const TITLE_TEMPLATES = [
  (s: string) => `${s} — скидка 50%`,
  (s: string) => `Только сегодня: ${s}`,
  (s: string) => `${s} по лучшей цене`,
  (s: string) => `Успей купить ${s}`,
  (s: string) => `🔥 ${s} с выгодой −50%`,
  (s: string) => `Новинка: ${s}`,
  (s: string) => `${s} с бесплатной доставкой`,
  (s: string) => `Хит продаж — ${s}`,
  (s: string) => `${s}: дешевле не найдёшь`,
];

const DESC_TEMPLATES = [
  (s: string) => `${s}. Доставка по всей стране за 1 день.`,
  (s: string) => `Закажите ${s} со скидкой до 50% прямо сейчас.`,
  (s: string) => `${s} — гарантия качества и быстрая доставка.`,
  (s: string) => `Только сегодня ${s} по специальной цене. Успейте!`,
  (s: string) => `Оригинальный ${s} с гарантией и доставкой за день.`,
  (s: string) => `${s}. Тысячи довольных покупателей уже с нами.`,
];

export function generateVariants(
  prompt: string,
  kind: "title" | "desc",
  max: number,
  target: number,
): string[] {
  const subj = prompt.replace(/\s+/g, " ").trim() || "ваш товар";
  const templates = kind === "desc" ? DESC_TEMPLATES : TITLE_TEMPLATES;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of templates) {
    const v = cap(fit(t(subj), max));
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  // Surface the variants closest to the desired length first.
  out.sort((a, b) => Math.abs(a.length - target) - Math.abs(b.length - target));
  return out;
}
