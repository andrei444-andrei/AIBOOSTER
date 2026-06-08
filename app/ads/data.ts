// Mock data + helpers for the Ad Creation Studio prototype.
// Self-contained so the prototype works without a backend.

export type Format = { id: string; label: string; w: number; h: number };
export type TextReq = {
  key: string;
  label: string;
  max: number;
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
  moderation: string[];
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
      { key: "title", label: "Заголовок", max: 30, kind: "title", hint: "Цепляющий, до 30" },
      { key: "desc", label: "Текст", max: 45, kind: "desc", hint: "Краткое описание, до 45" },
    ],
    moderation: [
      "Без шок-контента, насилия и материалов 18+",
      "Не обещать гарантированный доход или мгновенное обогащение",
      "Без медицинских заявлений о лечении заболеваний",
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
    moderation: [
      "Запрещены вводящие в заблуждение призывы и фейк-кнопки",
      "Без эротики и трагического/шокирующего контента",
      "Не использовать чужие бренды и логотипы без прав",
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
    moderation: [
      "Текст без CAPS LOCK во всю строку и лишних восклицаний",
      "Без обещаний «100% результата» и нереалистичной выгоды",
      "Соответствие возрастной маркировке и закону о рекламе",
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
    moderation: [
      "Дружелюбный тон, без агрессивных и пугающих формулировок",
      "Без медицинских и финансовых гарантий",
      "Без шок-контента и провокаций",
    ],
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
    moderation: [
      "Запрещены вводящие в заблуждение призывы и сенсационизм",
      "Без CAPS LOCK во всю строку и кликбейта",
      "Не использовать «бесплатно», если есть условия покупки",
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

// ---- Images --------------------------------------------------------------

const SHAPES: [number, number][] = [
  [1200, 1500],
  [1600, 1000],
  [1080, 1080],
  [1000, 1400],
  [1500, 1000],
  [1080, 1350],
  [1400, 1050],
  [1080, 1600],
];

export type Asset = {
  id: string;
  title: string;
  source: string;
  seed: string;
  url?: string;
  nw: number;
  nh: number;
};

function shaped(i: number): { nw: number; nh: number } {
  const [nw, nh] = SHAPES[i % SHAPES.length];
  return { nw, nh };
}

export const FAVORITES: Asset[] = [
  { id: "f1", title: "Кроссовки Nike", source: "nike.com", seed: "sneaker-77", ...shaped(0) },
  { id: "f2", title: "Часы premium", source: "pinterest.com", seed: "watch-12", ...shaped(1) },
  { id: "f3", title: "Зимняя куртка", source: "ozon.ru", seed: "jacket-9", ...shaped(2) },
  { id: "f4", title: "Смартфон flagship", source: "mvideo.ru", seed: "phone-31", ...shaped(3) },
  { id: "f5", title: "Утренний кофе", source: "unsplash.com", seed: "coffee-21", ...shaped(4) },
  { id: "f6", title: "Фитнес-зал", source: "fitgo.app", seed: "gym-5", ...shaped(5) },
  { id: "f7", title: "Авто премиум", source: "auto.ru", seed: "car-88", ...shaped(6) },
  { id: "f8", title: "Косметика", source: "goldapple.ru", seed: "beauty-4", ...shaped(7) },
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
    ...shaped(i + 2),
  }));
}

export const px = (seed: string, w: number, h: number) =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;
export const assetThumb = (a: Asset, size = 400) => a.url ?? px(a.seed, size, size);
export const assetFull = (a: Asset) => a.url ?? px(a.seed, a.nw, a.nh);

export function seedGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  const h2 = (h + 48) % 360;
  return `linear-gradient(135deg, hsl(${h} 72% 64%), hsl(${h2} 70% 46%))`;
}

// ---- News (pulled "по API" from the other project) ----------------------

export type News = {
  id: string;
  title: string;
  category: string;
  status: "Активный" | "На модерации";
  lang: string;
  country: string;
  seed: string;
  popularity: number;
  video?: boolean;
  mine?: boolean;
};

export const NEWS_CATEGORIES = [
  "Общество",
  "Политика",
  "Экономика",
  "Здоровье",
  "Авто",
  "Технологии",
  "Спорт",
  "Пикантное",
];

export const NEWS: News[] = [
  { id: "n1", title: "Учёные раскрыли неожиданную пользу обычной воды", category: "Здоровье", status: "Активный", lang: "RU", country: "Россия", seed: "news-water", popularity: 982, mine: true },
  { id: "n2", title: "Пенсионерам напомнили о новой выплате с 1 числа", category: "Общество", status: "Активный", lang: "RU", country: "Россия", seed: "news-pension", popularity: 1540 },
  { id: "n3", title: "Эксперт назвал лучшее время для покупки валюты", category: "Экономика", status: "Активный", lang: "RU", country: "Россия", seed: "news-currency", popularity: 1203, mine: true },
  { id: "n4", title: "В России обновили правила для автовладельцев", category: "Авто", status: "Активный", lang: "RU", country: "Россия", seed: "news-auto", popularity: 870 },
  { id: "n5", title: "Названы продукты, которые лучше не хранить в холодильнике", category: "Общество", status: "Активный", lang: "RU", country: "Россия", seed: "news-fridge", popularity: 1320 },
  { id: "n6", title: "Синоптики предупредили о резкой смене погоды", category: "Общество", status: "Активный", lang: "RU", country: "Россия", seed: "news-weather", popularity: 640, video: true },
  { id: "n7", title: "Раскрыт простой способ снизить счёт за свет", category: "Общество", status: "Активный", lang: "RU", country: "Россия", seed: "news-electric", popularity: 1101 },
  { id: "n8", title: "Что изменится для дачников этим летом", category: "Общество", status: "Активный", lang: "RU", country: "Россия", seed: "news-dacha", popularity: 770 },
  { id: "n9", title: "Врач объяснил, почему днём клонит в сон", category: "Здоровье", status: "Активный", lang: "RU", country: "Россия", seed: "news-sleep", popularity: 1450, mine: true },
  { id: "n10", title: "Названа неожиданная причина роста цен на кофе", category: "Экономика", status: "Активный", lang: "RU", country: "Россия", seed: "news-coffee", popularity: 905 },
  { id: "n11", title: "Какие города признаны лучшими для отдыха летом", category: "Общество", status: "Активный", lang: "RU", country: "Россия", seed: "news-cities", popularity: 1180, video: true },
  { id: "n12", title: "Финансист рассказал, как накопить на отпуск", category: "Экономика", status: "Активный", lang: "RU", country: "Россия", seed: "news-vacation", popularity: 1320 },
  { id: "n13", title: "Новый смартфон удивил ценой и автономностью", category: "Технологии", status: "Активный", lang: "RU", country: "Россия", seed: "news-phone", popularity: 990 },
  { id: "n14", title: "В Минтрансе ответили на вопрос о новых дорогах", category: "Политика", status: "На модерации", lang: "RU", country: "Россия", seed: "news-roads", popularity: 410 },
];

// ---- Flows (Потоки) ------------------------------------------------------

export type Flow = {
  id: string;
  name: string;
  region: string;
  type: "redirect" | "direct";
  domain: string;
  medium: string;
  content: string;
};

export const FLOWS: Flow[] = [
  { id: "77218", name: "test", region: "RU", type: "redirect", domain: "sneadpails.com", medium: "11958", content: "23f4307d-31b1-42b3-b26b-ef57d36896e2" },
  { id: "80597", name: "1", region: "RU", type: "redirect", domain: "sneadpails.com", medium: "11958", content: "23f4307d-31b1-42b3-b26b-ef57d36896e2" },
  { id: "81324", name: "RU push mainstream", region: "RU", type: "redirect", domain: "sneadpails.com", medium: "11960", content: "9a17be20-77c4-4f0a-9b1e-2c4471aa01dd" },
  { id: "79002", name: "EU tier-1", region: "EU", type: "direct", domain: "newsly.click", medium: "11971", content: "f0b2d934-6611-4a2c-8f33-7d2e9c5510aa" },
  { id: "83110", name: "CIS news", region: "CIS", type: "redirect", domain: "sneadpails.com", medium: "11958", content: "1c9e44a7-2b80-4d6b-93aa-58e0f1b7d2c4" },
];

export const FLOW_DOMAINS = ["sneadpails.com", "newsly.click", "trendwire.pro"];

export function flowUrl(f: Flow, domain?: string): string {
  return `https://${domain || f.domain}?utm_campaign=${f.id}&utm_content=${f.content}&utm_source=[SID]&utm_medium=${f.medium}`;
}

// ---- "AI" headline generator with moderation ----------------------------

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

const BANNED = ["гарантированный доход", "100% доход", "вылечит", "казино", "бесплатно навсегда"];

// Moderation as a "central prompt": reject obviously forbidden, soften shouting.
function moderate(s: string): string | null {
  const low = s.toLowerCase();
  if (BANNED.some((b) => low.includes(b))) return null;
  // no full-caps shouting
  const letters = s.replace(/[^A-Za-zА-Яа-я]/g, "");
  if (letters.length > 4 && s === s.toUpperCase()) return cap(s.toLowerCase());
  return s;
}

const TITLE_TEMPLATES = [
  (s: string) => `${s} — узнайте подробности`,
  (s: string) => `Только сегодня: ${s}`,
  (s: string) => `${s}: что важно знать`,
  (s: string) => `${s} — выгодное предложение`,
  (s: string) => `Новое: ${s}`,
  (s: string) => `${s} с выгодой до 50%`,
  (s: string) => `${s} — успейте оформить`,
  (s: string) => `Эксперты о том, как ${s}`,
];

const DESC_TEMPLATES = [
  (s: string) => `${s}. Подробности по ссылке — это займёт минуту.`,
  (s: string) => `Рассказываем про ${s} простыми словами.`,
  (s: string) => `${s} — проверенная информация и удобная подача.`,
  (s: string) => `Узнайте про ${s} больше прямо сейчас.`,
  (s: string) => `${s}. Тысячи читателей уже оценили материал.`,
  (s: string) => `Коротко и по делу: ${s}.`,
];

export function generateVariants(
  prompt: string,
  kind: "title" | "desc",
  max: number,
  target: number,
): string[] {
  const subj = prompt.replace(/\s+/g, " ").trim() || "ваш оффер";
  const templates = kind === "desc" ? DESC_TEMPLATES : TITLE_TEMPLATES;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of templates) {
    const mod = moderate(cap(fit(t(subj), max)));
    if (mod && !seen.has(mod)) {
      seen.add(mod);
      out.push(mod);
    }
  }
  out.sort((a, b) => Math.abs(a.length - target) - Math.abs(b.length - target));
  return out;
}
