// Обёртки над aimlapi.com — шлюз к LLM и TTS (CONSTITUTION §3).
// STT-этап вынесен в Apify (см. apify.js), потому что у aimlapi
// Whisper-эндпоинт async и требует публичный URL аудио — для нашего
// пайплайна с YouTube это излишне, Apify сразу отдаёт готовые субтитры.
//
// База API: https://api.aimlapi.com/v1
// - /chat/completions — LLM (GPT-4o / Claude)
// - /tts (proxy на ElevenLabs) — синтез

const BASE = process.env.AIMLAPI_BASE || "https://api.aimlapi.com/v1";
const KEY = process.env.AIMLAPI_KEY;
if (!KEY) {
  console.error("[aimlapi] AIMLAPI_KEY is required");
  process.exit(1);
}

const AUTH = { authorization: `Bearer ${KEY}` };

// ---------- LLM-перевод сегментов одним запросом (батчем) ----------
// Берём JSON-список с idx+text и просим вернуть JSON того же формата с
// translated_text. Сохраняем длину фраз ради синхрона.
export async function translateBatch(segments, { sourceLang, targetLang, model = "gpt-4o" }) {
  // Разбиваем на чанки ~80 сегментов, чтобы не упереться в контекст и
  // не получить обрезанный JSON.
  const CHUNK = 80;
  const out = [];
  for (let i = 0; i < segments.length; i += CHUNK) {
    const chunk = segments.slice(i, i + CHUNK);
    const part = await translateOneBatch(chunk, { sourceLang, targetLang, model });
    out.push(...part);
  }
  return out;
}

async function translateOneBatch(segments, { sourceLang, targetLang, model }) {
  const input = segments.map((s) => ({ idx: s.idx, text: s.text }));
  const sys =
    `Ты — профессиональный переводчик-дубляжист. Переводишь живую речь из видео ` +
    `на язык "${targetLang}". Сохраняй естественность разговорной речи, юмор, ` +
    `тон оригинала. ВАЖНО: длина перевода должна быть близка к длине оригинала ` +
    `по числу слогов — фразы будут озвучивать поверх видео. Не добавляй пояснений. ` +
    `Не объединяй и не разделяй сегменты — отвечай ровно по входным idx.`;
  const user =
    `Исходный язык: ${sourceLang || "auto"}. Целевой: ${targetLang}.\n` +
    `Верни строго валидный JSON массив объектов {"idx":number,"text":string} ` +
    `БЕЗ префикса, БЕЗ markdown, в том же порядке.\n\n` +
    `Вход:\n${JSON.stringify(input)}`;

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({
      model,
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
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? "[]";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`translator returned invalid JSON: ${raw.slice(0, 200)}`);
  }
  // Принимаем и массив, и обёртку {items:[...]}
  const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : null;
  if (!arr) throw new Error("translator JSON has no array");

  // Сопоставляем по idx.
  const byIdx = new Map(arr.map((r) => [Number(r.idx), String(r.text ?? "")]));
  return segments.map((s) => ({
    ...s,
    translated_text: byIdx.get(s.idx) ?? "",
  }));
}

// ---------- TTS через ElevenLabs (aimlapi proxy) ----------
// Принимает текст и язык → mp3 как Buffer.
// Модель eleven_multilingual_v2 — production-ready мультиязычный синтез.
export async function ttsSynth(text, { voice = "Rachel", model = "elevenlabs/eleven_multilingual_v2" } = {}) {
  // ElevenLabs eleven_multilingual_v2 определяет язык из текста сам, поле language
  // в API aimlapi не задокументировано — не шлём, чтобы не получить 400.
  const res = await fetch(`${BASE}/tts`, {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      text,
      voice,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`tts failed ${res.status}: ${t.slice(0, 400)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}
