// Перевод текста на английский через aimlapi (Gemini Flash — быстро + дешево).
// Используем в news/enrichment перед Sonar: английский веб в 10× больше и
// качественнее по технологиям/бизнесу/AI, чем русский. Если запрос
// содержит кириллицу — переводим. Иначе шлём как есть.

const BASE = process.env.AIMLAPI_BASE || "https://api.aimlapi.com/v1";
const TRANSLATION_MODEL = "google/gemini-2.5-flash";
const TRANSLATION_TIMEOUT_MS = 8_000;

export function hasCyrillic(s: string): boolean {
  return /[А-Яа-яЁё]/.test(s);
}

export async function ensureEnglish(text: string): Promise<string> {
  if (!hasCyrillic(text)) return text;
  const key = process.env.AIMLAPI_KEY;
  if (!key) return text; // мягкий fallback

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: TRANSLATION_MODEL,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Translate the user message to English for a web-search engine query. " +
              "Keep names, brands, tickers, and technical terms unchanged. " +
              "Respond with ONLY the translated text, no quotes, no prefixes.",
          },
          { role: "user", content: text },
        ],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return text;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const translated = data.choices?.[0]?.message?.content?.trim();
    return translated && translated.length > 0 ? translated : text;
  } catch {
    clearTimeout(timer);
    return text;
  }
}
