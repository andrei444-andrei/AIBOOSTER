// Apify — единственный источник YouTube-транскрипта. Apify держит residential
// прокси, поэтому обходит anti-bot, в отличие от cloud-IP serverless.
//
// Actor: pintostudio/youtube-transcript-scraper
// Endpoint: POST .../run-sync-get-dataset-items?token=<APIFY_TOKEN>

const ENDPOINT =
  "https://api.apify.com/v2/acts/pintostudio~youtube-transcript-scraper/run-sync-get-dataset-items";

export interface TranscriptSegment {
  idx: number;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface Transcript {
  title: string | null;
  duration: number | null;
  language: string | null;
  segments: TranscriptSegment[];
}

export async function fetchTranscript(videoUrl: string): Promise<Transcript> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is required");

  const url = `${ENDPOINT}?token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ videoUrl }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(explainApifyFailure(res.status, text));
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("у этого видео нет субтитров на YouTube — попробуй другое");
  }

  const first = (data[0] ?? {}) as Record<string, unknown>;
  const rawSegments: unknown[] = Array.isArray(first.transcript)
    ? (first.transcript as unknown[])
    : Array.isArray(first.data)
      ? (first.data as unknown[])
      : (data as unknown[]);

  const segments: TranscriptSegment[] = [];
  rawSegments.forEach((raw, idx) => {
    if (!raw || typeof raw !== "object") return;
    const r = raw as Record<string, unknown>;
    const text = String(r.text ?? r.transcript ?? "").trim();
    const start = toSeconds(r.start ?? r.offset ?? r.startTime);
    const dur = toSeconds(r.dur ?? r.duration ?? r.length);
    if (!text || !Number.isFinite(start)) return;
    const endSec = Number.isFinite(dur) && dur > 0 ? start + dur : start + 2;
    segments.push({
      idx,
      start_ms: Math.round(start * 1000),
      end_ms: Math.round(endSec * 1000),
      text,
    });
  });

  if (segments.length === 0) {
    throw new Error("Apify вернул пустой транскрипт — формат изменился");
  }

  return {
    title: (first.videoTitle as string) || (first.title as string) || null,
    duration:
      toSeconds(first.videoDuration ?? first.duration) || null,
    language:
      (first.language as string) || (first.transcriptLanguage as string) || null,
    segments,
  };
}

// Превращает отказ Apify в сообщение, по которому понятно, что делать.
// Раньше в карточку задачи прилетал сырой JSON вида
// `apify failed 403: {"error":{"type":"platform-feature-disabled",...}}` —
// технически точно и совершенно бесполезно. Сам ответ Apify всё равно
// уезжает в app_errors, так что для диагностики ничего не теряется.
function explainApifyFailure(status: number, body: string): string {
  const type = /"type"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? "";
  const message = /"message"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? "";
  const tail = ` [apify ${status}${type ? ` ${type}` : ""}]`;

  if (/hard limit|usage limit|monthly usage/i.test(message) || type === "platform-feature-disabled") {
    return (
      "у Apify (источник субтитров) закончился месячный лимит. " +
      "Пополни счёт или подними лимит в консоли Apify и нажми «Попробовать снова» — " +
      "уже сделанная работа не пропадёт." + tail
    );
  }
  if (status === 401 || status === 403) {
    return "Apify не принял токен — проверь APIFY_TOKEN." + tail;
  }
  if (status === 429) {
    return "Apify просит подождать — слишком много запросов подряд. Попробуй через пару минут." + tail;
  }
  if (status >= 500) {
    return "Apify сейчас недоступен — это временно, нажми «Попробовать снова» позже." + tail;
  }
  return (message || "не удалось получить субтитры с YouTube") + tail;
}

function toSeconds(v: unknown): number {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = s.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (m) {
    const h = m[1] ? parseInt(m[1], 10) : 0;
    const mm = parseInt(m[2], 10);
    const ss = parseFloat(m[3]);
    return h * 3600 + mm * 60 + ss;
  }
  return NaN;
}
