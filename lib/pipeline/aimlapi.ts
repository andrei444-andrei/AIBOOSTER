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

// Перевод цельного куска речи (≈ абзаца, до ~3 минут). Возвращает один связный
// перевод, не нарезанный по сегментам — это даёт переводчику свободу менять
// порядок слов, переформулировать под язык, склеивать обрывочные фразы YouTube-
// субтитров в нормальную речь. Цена — теряем точную привязку перевода к
// исходным таймкодам сегментов, но в подкаст-режиме это и не нужно: транскрипт
// показывает уже чанк-уровень, аудио играет в натуральном темпе TTS.
export async function translateChunk(
  sourceText: string,
  opts: { sourceLang: string | null; targetLang: string; model?: string },
): Promise<string> {
  const text = sourceText.trim();
  if (!text) return "";
  const model = opts.model ?? "gpt-4o";
  const sys =
    `Ты — профессиональный переводчик-локализатор. Переводишь живую речь из ` +
    `видео на язык "${opts.targetLang}". Это связный кусок речи (~3 минуты), ` +
    `склеенный из YouTube-субтитров. Твоя цель — естественно звучащий ` +
    `параграф на ${opts.targetLang}, как будто человек свободно говорит на ` +
    `этом языке. Меняй порядок слов под целевой язык, переформулируй фразы, ` +
    `склеивай обрывки субтитров в нормальные предложения, сохраняй тон и ` +
    `юмор оригинала. Никаких переводческих калек. Никаких пояснений, ` +
    `пометок, markdown, кавычек вокруг ответа — только сам перевод.`;
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
      temperature: 0.4,
      // 3 минуты речи ≈ 400-600 слов исходника. На русском с разворачиванием
      // запас 4000 токенов покрывает с большим запасом.
      max_tokens: 4000,
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
  return (raw ?? "").trim();
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
