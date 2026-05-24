// Обёртки над aimlapi.com — единственным шлюзом к AI-моделям (CONSTITUTION §3).
//
// База API: https://api.aimlapi.com/v1
// - /audio/transcriptions — Whisper (multipart/form-data, OpenAI-совместимый)
// - /chat/completions — LLM (GPT-4o / Claude)
// - /tts (proxy на ElevenLabs) — синтез

import fs from "node:fs";

const BASE = process.env.AIMLAPI_BASE || "https://api.aimlapi.com/v1";
const KEY = process.env.AIMLAPI_KEY;
if (!KEY) {
  console.error("[aimlapi] AIMLAPI_KEY is required");
  process.exit(1);
}

const AUTH = { authorization: `Bearer ${KEY}` };

// ---------- Whisper: ASR с word/segment-level таймкодами ----------
// Возвращает массив сегментов {start_ms,end_ms,text} и language.
export async function transcribe(audioPath, { model = "whisper-1", language } = {}) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(audioPath)]), "audio.mp3");
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  if (language) form.append("language", language);

  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: "POST",
    headers: AUTH,
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`whisper failed ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = await res.json();
  const segs = (data.segments ?? []).map((s, i) => ({
    idx: i,
    start_ms: Math.round((s.start ?? 0) * 1000),
    end_ms: Math.round((s.end ?? 0) * 1000),
    text: String(s.text ?? "").trim(),
  }));
  return { language: data.language || null, segments: segs };
}

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
export async function ttsSynth(text, { lang, voice = "Rachel", model = "eleven_multilingual_v2" } = {}) {
  const res = await fetch(`${BASE}/tts`, {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      text,
      voice,
      language: lang,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`tts failed ${res.status}: ${t.slice(0, 400)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}
