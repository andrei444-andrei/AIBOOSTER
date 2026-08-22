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

// Структурированный результат перевода чанка. Каждая utterance — реплика
// одного говорящего. Для монолога будет ровно 1 utterance со speaker=null.
// Для диалога 2+ utterance'ов с метками 'A','B','C',... — мы потом подберём
// для каждой метки свой голос TTS.
export interface TranslatedUtterance {
  speaker: string | null;
  text: string;
}

// Перевод цельного куска речи + детекция диалога. Возвращает массив реплик.
//
// Цель — слушабельный «подкаст» из обрывков YouTube-субтитров:
// - выкидываем филлеры, повторы, незаконченные мысли — текст должен быть
//   полированным, как будто спикер сам потом отредактировал свою запись
// - меняем порядок слов под язык, переформулируем — никаких переводческих
//   калек, должно звучать как обычная разговорная речь
// - распознаём диалог vs монолог; для диалога раздаём метки спикеров —
//   разные голоса в TTS придают сцене динамику
export async function translateChunk(
  sourceText: string,
  opts: { sourceLang: string | null; targetLang: string; model?: string },
): Promise<TranslatedUtterance[]> {
  const text = sourceText.trim();
  if (!text) return [];
  const model = opts.model ?? "gpt-4o";
  const sys =
    `Ты — переводчик и редактор подкаста. Делаешь из обрывочной речи на ` +
    `видео полированную аудиозапись на языке "${opts.targetLang}".\n\n` +
    `ЧТО ДЕЛАЕШЬ:\n` +
    `1. Переводишь смысл, а не слова — меняй порядок слов, переформулируй ` +
    `под целевой язык, склеивай обрывки в нормальные предложения. Должно ` +
    `звучать так, как говорил бы носитель.\n` +
    `2. ВЫКИДЫВАЙ словесный мусор: заикания, "uh/um", повторы ("ну вот я " ` +
    `"я хотел"), филлеры ("you know", "like", "значит", "короче", "вот"), ` +
    `незаконченные мысли, лишние подтверждения ("yeah right, yeah right"). ` +
    `Цель — чистый текст подкаста, как будто спикер сам потом отредактировал.\n` +
    `3. ОПРЕДЕЛЯЙ количество говорящих. Большинство YouTube-видео это ` +
    `монологи (лекция, vlog, обзор) — там один спикер. Интервью, подкасты ` +
    `и разговоры — это диалог с 2+ спикерами.\n\n` +
    `ФОРМАТ ОТВЕТА — строго JSON-объект:\n` +
    `{"utterances":[{"speaker":"A"|"B"|"C"|"D"|null,"text":"..."}, ...]}\n\n` +
    `ПРАВИЛА speaker:\n` +
    `- null — если монолог (один говорящий). НЕ дроби монолог искусственно ` +
    `на A/B — даже если спикер делает паузы или меняет тон.\n` +
    `- "A", "B", "C", "D" — если разные люди явно реплицируют друг другу. ` +
    `"A" — первый кто заговорил в этом куске. Метки уникальны в пределах ` +
    `одного чанка, но «A» в этом куске и «A» в следующем — могут быть ` +
    `разными людьми (мы не знаем контекста между чанками).\n` +
    `- Если сомневаешься «один спикер или два» — ставь null. Лучше ровный ` +
    `голос для слегка дробящегося монолога, чем дёрганые голоса для ` +
    `придуманного диалога.\n\n` +
    `Никакого markdown, никаких кавычек снаружи JSON. Только сам объект.`;
  const user =
    `Исходный язык: ${opts.sourceLang || "auto"}. Целевой: ${opts.targetLang}.\n\n` +
    `Текст:\n${text}`;

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      // 3 минуты речи ≈ 400-600 слов исходника. После выкидывания мусора
      // итог короче исходника — 4000 токенов с большим запасом.
      max_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`translate failed ${res.status}: ${t.slice(0, 400)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const raw =
    ((data.choices as Array<Record<string, unknown>> | undefined)?.[0]
      ?.message as Record<string, unknown> | undefined)?.content as string | undefined;
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Модель проигнорировала JSON-режим и отдала plain-текст —
    // ладно, считаем монологом.
    return [{ speaker: null, text: raw.trim() }];
  }
  return extractUtterances(parsed);
}

// Парсит ответ модели в наш формат TranslatedUtterance[]. Терпим к разным
// формам, в которые gpt-4o может сложить ответ под json_object.
function extractUtterances(parsed: unknown): TranslatedUtterance[] {
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;

  const candidate = (obj.utterances ?? obj.lines ?? obj.dialog ?? obj.parts) as unknown;
  if (Array.isArray(candidate)) {
    const utters = candidate
      .map((u) => normalizeUtterance(u))
      .filter((u): u is TranslatedUtterance => u !== null && u.text.length > 0);
    if (utters.length > 0) return utters;
  }

  // Fallback: модель отдала plain {text: "..."} или {translation: "..."} —
  // считаем монологом.
  const plain =
    (obj.text as string | undefined) ??
    (obj.translation as string | undefined) ??
    (obj.translated_text as string | undefined);
  if (typeof plain === "string" && plain.trim()) {
    return [{ speaker: null, text: plain.trim() }];
  }
  return [];
}

function normalizeUtterance(raw: unknown): TranslatedUtterance | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const speakerRaw = o.speaker;
  const speaker =
    typeof speakerRaw === "string" && speakerRaw.trim()
      ? speakerRaw.trim().toUpperCase().slice(0, 4)
      : null;
  const text =
    typeof o.text === "string"
      ? o.text.trim()
      : typeof o.line === "string"
        ? o.line.trim()
        : "";
  if (!text) return null;
  return { speaker: speaker === "NULL" ? null : speaker, text };
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
