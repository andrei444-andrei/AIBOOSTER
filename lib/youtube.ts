// Парсинг YouTube-URL и валидация.
//
// Поддерживаемые форматы:
//   https://www.youtube.com/watch?v=<id>
//   https://youtube.com/watch?v=<id>
//   https://youtu.be/<id>
//   https://www.youtube.com/shorts/<id>
//   https://www.youtube.com/embed/<id>
//   https://m.youtube.com/watch?v=<id>
//
// videoId YouTube — 11 символов из [A-Za-z0-9_-].

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function extractVideoId(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  // Уже сам id?
  if (VIDEO_ID_RE.test(raw)) return raw;

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }

  const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    return id && VIDEO_ID_RE.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "music.youtube.com") {
    return null;
  }

  // /watch?v=...
  const v = u.searchParams.get("v");
  if (v && VIDEO_ID_RE.test(v)) return v;

  // /shorts/<id>, /embed/<id>, /v/<id>, /live/<id>
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length >= 2) {
    const [prefix, id] = parts;
    if (["shorts", "embed", "v", "live"].includes(prefix) && VIDEO_ID_RE.test(id)) {
      return id;
    }
  }
  return null;
}

// Канонический URL ролика (нормализация для логов/кеша).
export function canonicalUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

// Список целевых языков, который показываем в селекте.
// Ключ — ISO-639-1, значение — название на русском.
// Ограничен языками, которые хорошо поддерживает ElevenLabs multilingual v2.
export const TARGET_LANGUAGES: { code: string; name: string }[] = [
  { code: "ru", name: "Русский" },
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "pl", name: "Polski" },
  { code: "tr", name: "Türkçe" },
  { code: "uk", name: "Українська" },
  { code: "nl", name: "Nederlands" },
  { code: "cs", name: "Čeština" },
  { code: "ar", name: "العربية" },
  { code: "zh", name: "中文" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "hi", name: "हिन्दी" },
];

export function isSupportedLang(code: string): boolean {
  return TARGET_LANGUAGES.some((l) => l.code === code);
}

export type Quality = "fast" | "best";
export function isSupportedQuality(q: string): q is Quality {
  return q === "fast" || q === "best";
}

// Лимит длины видео для v1 (60 минут).
export const MAX_DURATION_SEC = 60 * 60;
