// Эмбеддинги через aimlapi (OpenAI-compatible /v1/embeddings).
// Используется для дедупликации новостных карточек: похожие сюжеты из
// разных источников склеиваются в кластер по cosine similarity.
//
// text-embedding-3-small: 1536 dim, ~$0.02/1M tokens. На один title+lead
// уходит ~100 tokens, то есть ~$0.000002 per item. Можно не считать.

const BASE = process.env.AIMLAPI_BASE || "https://api.aimlapi.com/v1";
const EMBED_MODEL = "text-embedding-3-small";
const EMBED_TIMEOUT_MS = 15_000;

/** Возвращает эмбеддинги для массива строк ОДНИМ запросом. Порядок сохраняется. */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const key = process.env.AIMLAPI_KEY;
  if (!key) throw new Error("AIMLAPI_KEY is not set");
  if (texts.length === 0) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE}/embeddings`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: texts.map((t) => t.slice(0, 8000)),
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`embedBatch timeout after ${EMBED_TIMEOUT_MS}ms`);
    }
    throw err;
  }
  clearTimeout(timer);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`embeddings ${res.status}: ${t.slice(0, 400)}`);
  }
  const data = (await res.json()) as { data?: Array<{ index?: number; embedding?: number[] }> };
  const arr = data.data ?? [];
  // API гарантирует возвращение в том же порядке через index, но подстрахуемся.
  const out: number[][] = new Array(texts.length);
  for (let i = 0; i < arr.length; i++) {
    const idx = typeof arr[i].index === "number" ? arr[i].index! : i;
    const v = arr[i].embedding;
    if (Array.isArray(v)) out[idx] = v;
  }
  // Пустые слоты заполняем нулевым вектором — лучше чем undefined, не падает downstream.
  for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = [];
  return out;
}

/** Cosine similarity между двумя векторами. Возвращает 0..1.
 *  Если один из векторов пуст или нулевой — возвращает 0. */
export function cosineSim(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
