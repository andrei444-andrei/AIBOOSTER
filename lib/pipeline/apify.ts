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
    throw new Error(`apify failed ${res.status}: ${text.slice(0, 400)}`);
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

  // Сначала собираем начала и длительности, конец считаем вторым проходом:
  // когда актор не отдаёт dur, конец реплики — это начало следующей. Плоская
  // заглушка (start + 2) в таком случае оставляет между репликами дыры, а
  // дыра длиннее секунды читается дальше по пайплайну как пауза говорящего
  // и рвёт чанк. На видео с редкими репликами это превращало каждую реплику
  // в отдельный чанк.
  const parsed: Array<{ start: number; dur: number; text: string }> = [];
  rawSegments.forEach((raw) => {
    if (!raw || typeof raw !== "object") return;
    const r = raw as Record<string, unknown>;
    const text = String(r.text ?? r.transcript ?? "").trim();
    const start = toSeconds(r.start ?? r.offset ?? r.startTime);
    const dur = toSeconds(r.dur ?? r.duration ?? r.length);
    if (!text || !Number.isFinite(start)) return;
    parsed.push({ start, dur, text });
  });
  parsed.sort((a, b) => a.start - b.start);

  const segments: TranscriptSegment[] = parsed.map((p, idx) => {
    const next = parsed[idx + 1];
    const endSec =
      Number.isFinite(p.dur) && p.dur > 0
        ? p.start + p.dur
        : next
          ? Math.max(next.start, p.start + 0.5)
          : p.start + 2;
    return {
      idx,
      start_ms: Math.round(p.start * 1000),
      end_ms: Math.round(endSec * 1000),
      text: p.text,
    };
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
