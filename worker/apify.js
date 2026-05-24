// Apify — единственный источник транскрипта YouTube. Apify держит residential
// прокси и обходит YouTube anti-bot, что невозможно с yt-dlp на cloud-IP.
//
// Используется actor pintostudio/youtube-transcript-scraper:
//   POST https://api.apify.com/v2/acts/pintostudio~youtube-transcript-scraper
//        /run-sync-get-dataset-items?token=<APIFY_TOKEN>
//
// Возвращает массив элементов; форма у разных билдов чуть разная, поэтому
// парсер ниже принимает обе виденные мной формы:
//   A. [{ videoTitle, videoDuration, transcript: [{ text, start, dur }] }]
//   B. [{ text, start, duration }, ...]
//
// Если у видео нет субтитров — actor возвращает пустой массив, тогда кидаем
// понятную ошибку (без fallback на ASR в v1, см. README).

const ENDPOINT =
  "https://api.apify.com/v2/acts/pintostudio~youtube-transcript-scraper/run-sync-get-dataset-items";

const TOKEN = process.env.APIFY_TOKEN;

export async function fetchTranscript(videoUrl) {
  if (!TOKEN) throw new Error("APIFY_TOKEN is required");

  const url = `${ENDPOINT}?token=${encodeURIComponent(TOKEN)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ videoUrl }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`apify failed ${res.status}: ${text.slice(0, 400)}`);
  }

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("у этого видео нет субтитров на YouTube — попробуй другое");
  }

  const first = data[0] ?? {};
  const rawSegments = Array.isArray(first.transcript)
    ? first.transcript
    : Array.isArray(first.data)
      ? first.data
      : data;

  const segments = rawSegments
    .map((r, idx) => {
      const text = String(r?.text ?? r?.transcript ?? "").trim();
      const start = toSeconds(r?.start ?? r?.offset ?? r?.startTime);
      const dur = toSeconds(r?.dur ?? r?.duration ?? r?.length);
      if (!text || !Number.isFinite(start)) return null;
      const endSec = Number.isFinite(dur) && dur > 0 ? start + dur : start + 2;
      return {
        idx,
        start_ms: Math.round(start * 1000),
        end_ms: Math.round(endSec * 1000),
        text,
      };
    })
    .filter(Boolean);

  if (segments.length === 0) {
    throw new Error("Apify вернул пустой транскрипт — субтитры пусты или формат изменился");
  }

  return {
    title: first.videoTitle || first.title || null,
    duration: toSeconds(first.videoDuration ?? first.duration) || null,
    language: first.language || first.transcriptLanguage || null,
    segments,
  };
}

function toSeconds(v) {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  // hh:mm:ss(.ms) или mm:ss(.ms)
  const m = s.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (m) {
    const h = m[1] ? parseInt(m[1], 10) : 0;
    const mm = parseInt(m[2], 10);
    const ss = parseFloat(m[3]);
    return h * 3600 + mm * 60 + ss;
  }
  return NaN;
}
