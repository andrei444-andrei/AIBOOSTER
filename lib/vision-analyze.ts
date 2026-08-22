// Vision-анализ изображений через Claude Sonnet 4.6 (умеет vision) поверх
// aimlapi OpenAI-совместимого формата. Используется в enrichment'е для:
//   1. Отсеять логотипы / рекламу / декоративный мусор.
//   2. Сгенерировать осмысленную подпись для оставшихся.
//   3. Для графиков и скриншотов выудить ключевые данные (OCR-ish).
//
// Параллельно зовём по картинке за раз; на ошибки мягко падаем —
// картинка просто не пройдёт фильтр.

const BASE = process.env.AIMLAPI_BASE || "https://api.aimlapi.com/v1";
const VISION_MODEL = "claude-sonnet-4-6";
const TIMEOUT_MS = 18_000;

export type ImageCategory =
  | "photo"
  | "chart"
  | "screenshot"
  | "diagram"
  | "logo"
  | "decoration"
  | "ad"
  | "unclear";

export interface ImageAnalysis {
  url: string;
  caption: string;
  category: ImageCategory;
  is_relevant: boolean;
  meaning: string; // 2-3 предложения: что именно на картинке, кто/что изображено, почему это важно для статьи
  data_extracted: string | null; // для чартов/скриншотов — выжимка цифр, лейблов, UI-элементов
  cost_cents: number;
  latency_ms: number;
}

export async function analyzeImage(
  imageUrl: string,
  articleContext: string,
): Promise<ImageAnalysis | null> {
  const key = process.env.AIMLAPI_KEY;
  if (!key) return null;

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const system =
    "You analyze a news article image and return STRICT JSON in Russian. " +
    "Classify the image, write a caption, AND extract the semantic MEANING — what the reader " +
    "gets from this image, who/what is shown, what concrete data it conveys. " +
    "Skip logos, ads, decorative photos that don't help the reader.";

  const user = [
    {
      type: "text",
      text:
        `Контекст статьи: ${articleContext.slice(0, 500)}\n\n` +
        `Проанализируй изображение по URL. Верни JSON ОНЛИ:\n` +
        `{\n` +
        `  "caption": string,                              // 1 предложение — что на картинке\n` +
        `  "category": "photo"|"chart"|"screenshot"|"diagram"|"logo"|"decoration"|"ad"|"unclear",\n` +
        `  "is_relevant": boolean,                         // true только если картинка несёт смысловую нагрузку по теме статьи\n` +
        `  "meaning": string,                              // 2-3 предложения: КТО на картинке (имена, компании, продукты), ЧТО происходит, ЧТО конкретно изображение даёт читателю по теме. Никаких "красивая иллюстрация" — только смысл.\n` +
        `  "data_extracted": string|null                   // для chart/screenshot/diagram — выжимка ВСЕХ цифр, лейблов, UI-элементов в одну строку (X axis: ..., Y axis: ..., тренд: ..., точки: ...). null для остального.\n` +
        `}\n` +
        `Примеры релевантного: чарт с реальными данными (выудить цифры), скриншот продукта (что показано в UI), фото CEO/основателя в новости о компании (имя), реальный продакт-шот.\n` +
        `Примеры НЕрелевантного: логотип сайта, sidebar ad, social-share иконка, generic stock фото не связанное с историей, абстракция.`,
    },
    {
      type: "image_url",
      image_url: { url: imageUrl },
    },
  ];

  let res: Response;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    void err;
    return null;
  }
  clearTimeout(timer);

  const latencyMs = Date.now() - started;
  if (!res.ok) return null;

  const data = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  } | null;
  if (!data) return null;

  const raw = data.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Иногда модель оборачивает в ```json — попробуем извлечь.
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const r = parsed as Record<string, unknown>;
  const category = String(r.category ?? "unclear");
  const validCats: ImageCategory[] = ["photo", "chart", "screenshot", "diagram", "logo", "decoration", "ad", "unclear"];
  const cat: ImageCategory = (validCats as string[]).includes(category) ? (category as ImageCategory) : "unclear";

  // Стоимость грубо: vision-картинка ~1.5К tok input + ~150 tok output Sonnet 4.6
  // ($3/M + $15/M) ≈ $0.007 = 0.7¢
  const inT = data.usage?.prompt_tokens ?? 1500;
  const outT = data.usage?.completion_tokens ?? 150;
  const cost_cents = Math.ceil((inT * 0.000003 + outT * 0.000015) * 100);

  return {
    url: imageUrl,
    caption: typeof r.caption === "string" ? r.caption.slice(0, 400) : "",
    category: cat,
    is_relevant: r.is_relevant === true,
    meaning: typeof r.meaning === "string" ? r.meaning.slice(0, 1500) : "",
    data_extracted: typeof r.data_extracted === "string" && r.data_extracted.trim() ? r.data_extracted.slice(0, 1500) : null,
    cost_cents,
    latency_ms: latencyMs,
  };
}

// Применяет analyzeImage параллельно к списку URL'ов и фильтрует.
// Возвращает отсортированный по полезности набор.
export async function analyzeImageBatch(
  urls: string[],
  articleContext: string,
  opts: { maxConcurrent?: number; maxToAnalyze?: number } = {},
): Promise<{ analyses: ImageAnalysis[]; cost_cents: number }> {
  const cap = Math.min(opts.maxToAnalyze ?? 8, urls.length);
  const targets = urls.slice(0, cap);
  if (targets.length === 0) return { analyses: [], cost_cents: 0 };

  const results = await Promise.all(targets.map((u) => analyzeImage(u, articleContext)));
  const analyses: ImageAnalysis[] = [];
  let cost_cents = 0;
  for (const a of results) {
    if (a) {
      analyses.push(a);
      cost_cents += a.cost_cents;
    }
  }
  // Сортировка: relevant сверху, затем chart/screenshot/photo, отбрасываем
  // logo/decoration/ad если оказались relevant=true (мало вероятно).
  const rank: Record<ImageCategory, number> = {
    chart: 5,
    screenshot: 5,
    diagram: 4,
    photo: 4,
    unclear: 2,
    logo: 0,
    decoration: 0,
    ad: 0,
  };
  analyses.sort((a, b) => {
    if (a.is_relevant !== b.is_relevant) return a.is_relevant ? -1 : 1;
    return (rank[b.category] ?? 0) - (rank[a.category] ?? 0);
  });
  return { analyses, cost_cents };
}
