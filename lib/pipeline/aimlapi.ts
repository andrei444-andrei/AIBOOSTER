// Обёртки над aimlapi.com — LLM-перевод и ElevenLabs TTS.
//
// База: https://api.aimlapi.com/v1
// - /chat/completions — LLM
// - /tts — proxy на ElevenLabs

const BASE = process.env.AIMLAPI_BASE || "https://api.aimlapi.com/v1";

function key(): string {
  const k = process.env.AIMLAPI_KEY;
  if (!k) throw new Error("AIMLAPI_KEY is required");
  return k;
}

export interface SegmentInput {
  idx: number;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface TranslatedSegment extends SegmentInput {
  translated_text: string;
}

// LLM-перевод сегментов батчем, с сохранением idx. Возвращает массив той же
// длины, что и вход; для пропавших сегментов translated_text = "".
export async function translateBatch(
  segments: SegmentInput[],
  opts: { sourceLang: string | null; targetLang: string; model?: string },
): Promise<TranslatedSegment[]> {
  const model = opts.model ?? "gpt-4o";
  const CHUNK = 80;
  const out: TranslatedSegment[] = [];
  for (let i = 0; i < segments.length; i += CHUNK) {
    const chunk = segments.slice(i, i + CHUNK);
    const part = await translateOneBatch(chunk, { ...opts, model });
    out.push(...part);
  }
  return out;
}

async function translateOneBatch(
  segments: SegmentInput[],
  opts: { sourceLang: string | null; targetLang: string; model: string },
): Promise<TranslatedSegment[]> {
  const input = segments.map((s) => ({ idx: s.idx, text: s.text }));
  const sys =
    `Ты — профессиональный переводчик-дубляжист. Переводишь живую речь из видео ` +
    `на язык "${opts.targetLang}". Сохраняй естественность речи, юмор, тон оригинала. ` +
    `ВАЖНО: длина перевода должна быть близка к длине оригинала по числу слогов — ` +
    `фразы будут озвучивать поверх видео. Не добавляй пояснений. ` +
    `Не объединяй и не разделяй сегменты — отвечай ровно по входным idx.`;
  const user =
    `Исходный язык: ${opts.sourceLang || "auto"}. Целевой: ${opts.targetLang}.\n` +
    `Верни строго валидный JSON массив объектов {"idx":number,"text":string} ` +
    `БЕЗ префикса, БЕЗ markdown, в том же порядке.\n\n` +
    `Вход:\n${JSON.stringify(input)}`;

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`translate failed ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const raw =
    ((data.choices as Array<Record<string, unknown>> | undefined)?.[0]
      ?.message as Record<string, unknown> | undefined)?.content as string | undefined;
  const text = raw ?? "[]";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`translator returned invalid JSON: ${text.slice(0, 200)}`);
  }
  const arr = Array.isArray(parsed)
    ? (parsed as Array<{ idx: unknown; text: unknown }>)
    : Array.isArray((parsed as Record<string, unknown>)?.items)
      ? ((parsed as Record<string, unknown>).items as Array<{ idx: unknown; text: unknown }>)
      : null;
  if (!arr) throw new Error("translator JSON has no array");

  const byIdx = new Map<number, string>(
    arr.map((r) => [Number(r.idx), String(r.text ?? "")]),
  );
  return segments.map((s) => ({
    ...s,
    translated_text: byIdx.get(s.idx) ?? "",
  }));
}

// ElevenLabs TTS через aimlapi proxy. Возвращает mp3 как Buffer.
export async function ttsSynth(
  text: string,
  opts: { voice?: string; model?: string } = {},
): Promise<Buffer> {
  const voice = opts.voice ?? "Rachel";
  const model = opts.model ?? "elevenlabs/eleven_multilingual_v2";

  const res = await fetch(`${BASE}/tts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, text, voice }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`tts failed ${res.status}: ${t.slice(0, 400)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
