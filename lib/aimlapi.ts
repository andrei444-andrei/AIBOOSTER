// Тонкий клиент aimlapi.com — единственный шлюз к LLM (CONSTITUTION §3).
//
// База: https://api.aimlapi.com/v1 (OpenAI-совместимый). Один ключ AIMLAPI_KEY
// открывает всё семейство моделей (GPT, Claude, Gemini, Perplexity).
//
// Этот модуль — TS-портирование того, что worker/aimlapi.js делает на чистом
// JS для пайплайна перевода. Не импортируем worker-версию, чтобы не тащить
// node-specifics + чтобы Vercel-функции остались бандлируемыми.

const BASE = process.env.AIMLAPI_BASE || "https://api.aimlapi.com/v1";

export interface ChatJsonInput {
  model: string;
  system: string;
  user: string;
  temperature?: number;
  // Таймаут одного LLM-запроса. Без него зависший вызов съест весь бюджет
  // serverless-функции (60s) — валидатор обработает 1 пост вместо 10.
  timeoutMs?: number;
  // Лимит на токены ответа. Для длинного синтеза Opus'у нужно много —
  // дефолт 16k чтобы статья 1500-1800 слов точно не была обрезана.
  maxTokens?: number;
  // requestId — только для логов/отладки; в запрос не отправляется.
  requestId?: string;
}

export interface ChatJsonResult<T> {
  parsed: T;
  rawText: string;
  model: string;
  latencyMs: number;
}

// Звонок в /chat/completions с включённым JSON-mode. На случай, если модель
// (например, Claude через aimlapi) проигнорирует response_format и завернёт
// JSON в markdown-блок — есть fallback-извлечение (см. extractJsonObject).
//
// Не глотает ошибки HTTP/сети — кидает Error с понятным message; вызывающий
// сам решает, что считать fatal (например, в pipeline.ts мы помечаем item
// как failed, а не валим весь tick).
export async function chatJson<T>(input: ChatJsonInput): Promise<ChatJsonResult<T>> {
  const key = process.env.AIMLAPI_KEY;
  if (!key) {
    throw new Error("AIMLAPI_KEY is not set");
  }

  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxTokens ?? 16384,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`aimlapi timeout after ${timeoutMs}ms`);
    }
    throw err;
  }
  clearTimeout(timer);

  const latencyMs = Date.now() - started;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `aimlapi ${res.status}: ${text.slice(0, 400) || res.statusText}`,
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = data.choices?.[0]?.message?.content ?? "";

  const obj = extractJsonObject(rawText);
  if (obj === null) {
    throw new Error(
      `aimlapi returned non-JSON content: ${rawText.slice(0, 200)}`,
    );
  }

  return {
    parsed: obj as T,
    rawText,
    model: input.model,
    latencyMs,
  };
}

// Сначала пробуем JSON.parse как есть. Если не вышло — снимаем markdown-fences
// и пробуем снова. В последнюю очередь — regex по первому сбалансированному
// {...} или [...]-блоку (нужно для Claude через aimlapi, который иногда
// добавляет "Here is the JSON:" перед телом). Учитываем строки — внутри
// "..."-литерала фигурные скобки не считаем за уровень вложенности.
export function extractJsonObject(text: string): unknown | null {
  const t = text.trim();
  if (!t) return null;

  try {
    return JSON.parse(t);
  } catch {
    /* fallthrough */
  }

  const stripped = t
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (stripped !== t) {
    try {
      return JSON.parse(stripped);
    } catch {
      /* fallthrough */
    }
  }

  // Ищем первый '{' или '['.
  let first = -1;
  let openCh = "{";
  let closeCh = "}";
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (c === "{" || c === "[") {
      first = i;
      openCh = c;
      closeCh = c === "{" ? "}" : "]";
      break;
    }
  }
  if (first === -1) return null;

  let depth = 0;
  let inStr = false;
  let escape = false;
  let stackTrace: string[] = []; // что открыли (для восстановления)
  for (let i = first; i < stripped.length; i++) {
    const ch = stripped[i];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
      stackTrace.push(ch);
    } else if (ch === "}" || ch === "]") {
      depth--;
      stackTrace.pop();
      if (depth === 0) {
        const slice = stripped.slice(first, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
  }
  // ДОБАВКА: response был ОБРЕЗАН (depth > 0, дошли до конца). Пробуем
  // спасти — закрываем строку и оставшиеся открытые скобки/массивы.
  if (depth > 0) {
    let salvage = stripped.slice(first);
    if (inStr) salvage += '"'; // закрываем висящую строку
    // Если последний символ — запятая или незавершённый ключ — обрежем до
    // последней валидной запятой/значения.
    salvage = salvage.replace(/,\s*$/, "");
    salvage = salvage.replace(/"\s*:\s*$/, '": null');
    salvage = salvage.replace(/:\s*$/, ": null");
    // Закрываем стек в обратном порядке.
    for (let i = stackTrace.length - 1; i >= 0; i--) {
      salvage += stackTrace[i] === "{" ? "}" : "]";
    }
    try {
      return JSON.parse(salvage);
    } catch {
      return null;
    }
  }
  return null;
}
