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
  // 40 сегментов в батче — компромисс между «один запрос на всё» (модель
  // может схалтурить) и «по одному» (медленно). При gpt-4o 40 сегментов
  // ≈ 2000-3000 токенов output, влезает уверенно.
  const CHUNK = 40;
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
    `Ты — профессиональный переводчик. Переводишь живую речь из видео ` +
    `на язык "${opts.targetLang}". Сохраняй естественность речи, юмор, тон оригинала. ` +
    `Не объединяй и не разделяй сегменты — на каждый входной idx ровно один ` +
    `перевод. Не добавляй пояснений.`;
  const user =
    `Исходный язык: ${opts.sourceLang || "auto"}. Целевой: ${opts.targetLang}.\n` +
    `На входе ${input.length} сегментов. Верни ровно ${input.length} переводов в ` +
    `формате JSON: {"items":[{"idx":number,"text":string}, ...]} в том же порядке.\n` +
    `Никаких других ключей, никакого markdown, никакого текста снаружи объекта.\n\n` +
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
      // max_tokens должен покрыть translation для всего батча. На 80 сегментов
      // по ~50 токенов на перевод = 4000+ токенов. Без явного лимита gpt-4o
      // могла обрезать на 1-м сегменте.
      max_tokens: 8000,
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
  const arr = findTranslationsArray(parsed);
  if (!arr) {
    throw new Error(
      `translator JSON has no array (keys=${Object.keys((parsed as object) ?? {}).join(",")}): ${JSON.stringify(parsed).slice(0, 200)}`,
    );
  }
  // Если модель вернула меньше чем мы просили — это уже не ок, лучше упасть
  // явно, чем кидать в TTS pустые сегменты.
  if (arr.length < segments.length * 0.5) {
    throw new Error(
      `translator returned only ${arr.length}/${segments.length} items — модель ` +
        `вернула не все переводы. Это может быть из-за max_tokens или того, что ` +
        `модель посчитала текст «не требующим перевода». Первый item: ${JSON.stringify(arr[0]).slice(0, 200)}`,
    );
  }

  const byIdx = new Map<number, string>(
    arr.map((r) => [Number(r.idx), String(r.text ?? r.translated_text ?? r.translation ?? "")]),
  );
  return segments.map((s) => ({
    ...s,
    translated_text: byIdx.get(s.idx) ?? "",
  }));
}

// gpt-4o с response_format=json_object отдаёт ВСЕГДА объект, не чистый массив.
// Поэтому ищем массив переводов в самом объекте, перебирая популярные имена,
// а если не нашли — берём первый массив объектов с полем idx или text.
function findTranslationsArray(parsed: unknown): Array<{ idx: unknown; text?: unknown; translated_text?: unknown; translation?: unknown }> | null {
  if (Array.isArray(parsed)) return parsed as Array<{ idx: unknown; text?: unknown }>;
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  // Если объект сам похож на одну translation-строку — на батче из 1 сегмента
  // gpt-4o возвращает {"idx": 0, "text": "..."} вместо массива.
  if ("idx" in obj && ("text" in obj || "translated_text" in obj || "translation" in obj)) {
    return [obj as { idx: unknown; text?: unknown }];
  }
  const knownKeys = ["items", "translations", "segments", "data", "result", "results", "output"];
  for (const k of knownKeys) {
    const v = obj[k];
    if (Array.isArray(v)) return v as Array<{ idx: unknown }>;
  }
  // Fallback: первый property с массивом объектов, в которых есть idx или text.
  for (const v of Object.values(obj)) {
    if (
      Array.isArray(v) &&
      v.length > 0 &&
      typeof v[0] === "object" &&
      v[0] !== null &&
      ("idx" in v[0] || "text" in v[0])
    ) {
      return v as Array<{ idx: unknown }>;
    }
  }
  return null;
}

// ElevenLabs TTS через aimlapi proxy. Возвращает mp3 как Buffer.
// На транзиентных 5xx/таймаутах ретраим до 2 раз с экспоненциальной паузой
// — на длинных видео типичен 524 от Cloudflare aimlapi, если сразу падать
// то теряется весь прогон.
export async function ttsSynth(
  text: string,
  opts: { voice?: string; model?: string } = {},
): Promise<Buffer> {
  const voice = opts.voice ?? "Rachel";
  const model = opts.model ?? "elevenlabs/eleven_multilingual_v2";

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      // 0.5s, 1.5s
      await new Promise((r) => setTimeout(r, 500 * Math.pow(3, attempt - 1)));
    }
    try {
      const res = await fetch(`${BASE}/tts`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model, text, voice }),
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      const t = await res.text().catch(() => "");
      const err = new Error(`tts failed ${res.status}: ${t.slice(0, 200)}`);
      // 4xx (кроме 429) — фатально, ретрай не поможет.
      if (res.status < 500 && res.status !== 429) throw err;
      lastErr = err;
    } catch (e) {
      // Network errors — ретрай.
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error("tts failed (no error captured)");
}
