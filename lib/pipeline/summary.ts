// Краткое описание + автоматические главы по смыслу — один LLM-вызов
// после того как все чанки переведены и их output-таймкоды известны.
// Используется в /tools/youtube-translate для карточек и навигации в плеере.

const BASE = process.env.AIMLAPI_BASE || "https://api.aimlapi.com/v1";

function key(): string {
  const k = process.env.AIMLAPI_KEY;
  if (!k) throw new Error("AIMLAPI_KEY is required");
  return k;
}

export interface Chapter {
  start_sec: number;
  title: string;
}

export interface VideoMeta {
  summary: string;
  chapters: Chapter[];
}

export async function generateVideoMeta(args: {
  chunks: Array<{ start_sec: number; text: string }>;
  targetLang: string;
  durationSec: number;
  model?: string;
}): Promise<VideoMeta> {
  const usableChunks = args.chunks.filter((c) => c.text.trim().length > 0);
  if (usableChunks.length === 0) {
    return { summary: "", chapters: [] };
  }
  const model = args.model ?? "gpt-4o";

  // Сборка input'а: каждая часть с таймкодом — LLM сможет выбрать из них
  // те, что начинают новую тему и взять их start_sec для глав.
  const partsBlock = usableChunks
    .map((c) => `[${Math.round(c.start_sec)}s] ${c.text}`)
    .join("\n\n");

  const sys =
    `Ты пишешь карточки подкастов. На вход — расшифровка видео, разбитая ` +
    `на части с таймкодами в секундах от начала аудио. Целевой язык всего ` +
    `вывода: "${args.targetLang}".\n\n` +
    `Сделай две вещи:\n\n` +
    `1) summary — 2-3 предложения о чём это видео. Конкретно по сути, без ` +
    `«в этом видео автор рассказывает…». Сразу к содержанию: что важного ` +
    `узнает слушатель, какая главная мысль или новость.\n\n` +
    `2) chapters — главы по смыслу для навигации, 3-8 штук. Каждая ` +
    `глава = смысловой блок, не просто «следующая минута». Заголовок ` +
    `короткий (3-7 слов), передаёт суть раздела (например «Что такое ` +
    `электросеть» — да, «Введение» — нет). start_sec — секунда из ` +
    `таймкода той части, где раздел начинается. Первая глава должна ` +
    `начинаться с 0.\n\n` +
    `ФОРМАТ — строго JSON-объект:\n` +
    `{"summary":"...","chapters":[{"start_sec":0,"title":"..."}, ...]}\n\n` +
    `Никаких пояснений, markdown, кавычек снаружи JSON.`;

  const user =
    `Длительность аудио ≈ ${Math.round(args.durationSec)} сек.\n\n` +
    `Расшифровка:\n${partsBlock}`;

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 1500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`generateVideoMeta failed ${res.status}: ${t.slice(0, 400)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const raw =
    ((data.choices as Array<Record<string, unknown>> | undefined)?.[0]
      ?.message as Record<string, unknown> | undefined)?.content as string | undefined;
  if (!raw) return { summary: "", chapters: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { summary: "", chapters: [] };
  }

  return normalizeMeta(parsed, args.durationSec);
}

function normalizeMeta(parsed: unknown, durationSec: number): VideoMeta {
  if (!parsed || typeof parsed !== "object") {
    return { summary: "", chapters: [] };
  }
  const obj = parsed as Record<string, unknown>;
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";

  const chaptersRaw = obj.chapters;
  const chapters: Chapter[] = [];
  if (Array.isArray(chaptersRaw)) {
    for (const c of chaptersRaw) {
      if (!c || typeof c !== "object") continue;
      const o = c as Record<string, unknown>;
      const startSec = typeof o.start_sec === "number" ? o.start_sec : Number(o.start_sec);
      const title = typeof o.title === "string" ? o.title.trim() : "";
      if (!Number.isFinite(startSec) || startSec < 0 || !title) continue;
      // Игнорируем главы за пределами длительности — LLM иногда выдумывает.
      if (startSec > durationSec + 1) continue;
      chapters.push({ start_sec: Math.round(startSec), title });
    }
  }
  // Сортируем по времени, дедупим близкие (в пределах 5 сек считаем одной).
  chapters.sort((a, b) => a.start_sec - b.start_sec);
  const dedup: Chapter[] = [];
  for (const c of chapters) {
    if (dedup.length === 0 || c.start_sec - dedup[dedup.length - 1].start_sec >= 5) {
      dedup.push(c);
    }
  }
  // Гарантируем что первая глава начинается с нуля — даже если LLM решил
  // что «Введение» это первые 10 секунд, навигация должна стартовать с 0.
  if (dedup.length > 0 && dedup[0].start_sec > 0) {
    dedup[0] = { start_sec: 0, title: dedup[0].title };
  }
  return { summary, chapters: dedup };
}
