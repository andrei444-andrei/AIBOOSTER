// AI-роутер: на каждый запрос подбирает модель и параметры.
//
// Вход: режим (normal | pro), история, текст последнего сообщения,
// необязательный override-модель. Выход: RoutingDecision — какая модель,
// какие параметры, какой system-addon приклеить.
//
// Стратегия:
// 1. Если override задан — берём его модель, но всё равно подбираем
//    параметры под режим (max_tokens, reasoning_effort).
// 2. Иначе — спрашиваем у быстрой модели (Gemini Flash), классификация
//    в строгом JSON. Если она упала или ответила криво — эвристический
//    фолбэк по ключевым словам.
// 3. По категории + режиму выбираем модель из таблицы. Параметры —
//    из той же таблицы.

import { MODELS, chatText, AIError } from "./ai";
import {
  type ChatMode,
  type TaskCategory,
  getModelOption,
  isKnownModel,
} from "./chat-client";

export type Complexity = "low" | "medium" | "high";

export interface RoutingDecision {
  model: string;
  category: TaskCategory;
  complexity: Complexity;
  mode: ChatMode;
  max_tokens: number;
  reasoning_effort?: "low" | "medium" | "high";
  /** Доп. инструкции к system-промту, специфичные для категории. */
  system_addon?: string;
  /** Как принято решение: override от пользователя, авто-роутер, фолбэк. */
  source: "override" | "auto" | "fallback";
  /** Короткая причина для UI. */
  reason: string;
  /** Сколько занял сам роутер. 0 если override/fallback без сетевого запроса. */
  routing_latency_ms: number;
  /** Эвристика безопасности: классификация уверенная? */
  uncertain?: boolean;
}

// ─── Таблица выбора модели по (категория × режим) ───────────────────

interface ModelPick {
  model: string;
  max_tokens: number;
  reasoning_effort?: "low" | "medium" | "high";
}

function pickModelFor(category: TaskCategory, mode: ChatMode, multimodalNeeded: boolean): ModelPick {
  // multimodal-кейс (есть картинки) — фильтруем модели, поддерживающие images.
  // Sonar Pro не multimodal, отсекаем его.
  if (mode === "normal") {
    switch (category) {
      case "quick":
        return { model: MODELS.GEMINI_FLASH, max_tokens: 2000 };
      case "research":
        return multimodalNeeded
          ? { model: MODELS.CLAUDE_SONNET, max_tokens: 4000 }
          : { model: MODELS.PERPLEXITY_SONAR, max_tokens: 4000 };
      case "code":
        return { model: MODELS.CLAUDE_SONNET, max_tokens: 4000 };
      case "analyze":
        return { model: MODELS.CLAUDE_SONNET, max_tokens: 4000 };
      case "strategy":
        return { model: MODELS.CLAUDE_SONNET, max_tokens: 4000 };
    }
  }
  // pro
  switch (category) {
    case "quick":
      return { model: MODELS.CLAUDE_SONNET, max_tokens: 4000 };
    case "research":
      return multimodalNeeded
        ? { model: MODELS.CLAUDE_OPUS, max_tokens: 8000 }
        : { model: MODELS.PERPLEXITY_SONAR, max_tokens: 6000 };
    case "code":
      return { model: MODELS.CLAUDE_OPUS, max_tokens: 8000 };
    case "analyze":
      return { model: MODELS.GEMINI_PRO, max_tokens: 8000 };
    case "strategy":
      return { model: MODELS.GPT_5, max_tokens: 8000, reasoning_effort: "high" };
  }
}

// ─── System-аддоны по категориям ────────────────────────────────────

const SYSTEM_ADDONS: Record<TaskCategory, string> = {
  quick: "Это короткий вопрос. Отвечай прямо, без лишней структуры, в 1–3 абзаца.",
  research:
    "Это ресёрч-задача. Структурируй ответ так: краткий вывод сверху, затем факты с источниками (если используешь поиск — давай ссылки), в конце — оговорки и слепые зоны.",
  code:
    "Это задача про код. Сначала покажи готовое решение в блоке кода, затем коротко объясни ключевые места. Если данных недостаточно — задай уточняющий вопрос вместо догадок.",
  analyze:
    "Это задача анализа. Раздели ответ на: что в данных → ключевые выводы → риски → следующие шаги. Будь конкретен, опирайся только на предоставленные данные.",
  strategy:
    "Это стратегическая задача. Дай 2–3 варианта с pro/con каждого, заверши явной рекомендацией и причинами. Не уклоняйся от выбора.",
};

// ─── Параметры под режим ────────────────────────────────────────────

function tuneForMode(pick: ModelPick, mode: ChatMode): ModelPick {
  // reasoning-модели (gpt-5*) едят бюджет на скрытые рассуждения.
  // В normal — экономим. В pro — даём думать.
  const isReasoning = pick.model.startsWith("gpt-5");
  if (mode === "pro") {
    if (isReasoning) {
      return {
        ...pick,
        max_tokens: Math.max(pick.max_tokens, 8000),
        reasoning_effort: pick.reasoning_effort ?? "high",
      };
    }
    return { ...pick, max_tokens: Math.max(pick.max_tokens, 6000) };
  }
  // normal
  if (isReasoning) {
    return {
      ...pick,
      max_tokens: Math.max(pick.max_tokens, 4000),
      reasoning_effort: pick.reasoning_effort ?? "low",
    };
  }
  return pick;
}

// ─── Авто-классификация через Gemini Flash ──────────────────────────

interface ClassifierOutput {
  category: TaskCategory;
  complexity: Complexity;
  reason: string;
}

const CLASSIFIER_SYSTEM = `Ты — классификатор задач для AI-чата. Получаешь последнее сообщение пользователя и краткий контекст. Возвращаешь СТРОГО JSON:
{"category": "<quick|research|code|analyze|strategy>", "complexity": "<low|medium|high>", "reason": "<до 80 символов на русском>"}

Категории:
- quick: короткий фактический вопрос, уточнение, перевод, определение
- research: «найди», «сравни источники», «что говорят про…», запрос на ссылки и факты
- code: написать/починить/объяснить код, debug, рефакторинг, ревью
- analyze: разобрать данные, документ, логи, дать выводы по предоставленному
- strategy: продумать варианты, принять решение, план, креатив, бизнес-выбор

Complexity:
- low: можно ответить за 1–2 абзаца без глубокой работы
- medium: нужен структурированный ответ, несколько аспектов
- high: длинный ответ, много шагов рассуждения

Только JSON, никакого текста вокруг.`;

/** Вытащить первый JSON-объект из произвольной строки. Модели любят добавлять
 *  префикс ("Конечно, вот JSON:") или обернуть в ```json ... ``` — режем всё это. */
function extractJsonObject(s: string): string | null {
  // приоритет: первый блок ```json ... ``` (если есть)
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) {
    const inner = fence[1].trim();
    if (inner.startsWith("{")) return inner;
  }
  // фолбэк: первая `{` до последней `}` со сбалансированными скобками
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

async function classify(
  userText: string,
  recentHistory: string,
): Promise<ClassifierOutput | null> {
  try {
    const prompt = recentHistory
      ? `Недавняя история:\n${recentHistory}\n\n---\nПоследнее сообщение:\n${userText}`
      : userText;
    const raw = await chatText(
      {
        model: MODELS.GEMINI_FLASH,
        system: CLASSIFIER_SYSTEM,
        user: prompt,
        // Gemini Flash тратит часть бюджета на скрытые reasoning-токены —
        // ставим достаточно, чтобы хватило и на них, и на короткий JSON.
        max_tokens: 1200,
        temperature: 0,
      },
      // короткий таймаут — если роутер тупит, идём на эвристику
      { signal: AbortSignal.timeout(8000) },
    );
    const jsonStr = extractJsonObject(raw);
    if (!jsonStr) {
      // eslint-disable-next-line no-console
      console.warn("[router] classifier returned non-JSON:", raw.slice(0, 200));
      return null;
    }
    const parsed = JSON.parse(jsonStr) as ClassifierOutput;
    if (!isCategory(parsed.category) || !isComplexity(parsed.complexity)) return null;
    return {
      category: parsed.category,
      complexity: parsed.complexity,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 120) : "",
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[router] classifier failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

function isCategory(v: unknown): v is TaskCategory {
  return v === "quick" || v === "research" || v === "code" || v === "analyze" || v === "strategy";
}
function isComplexity(v: unknown): v is Complexity {
  return v === "low" || v === "medium" || v === "high";
}

// ─── Эвристический фолбэк ───────────────────────────────────────────

function heuristicClassify(userText: string): ClassifierOutput {
  const t = userText.toLowerCase();
  // JS \b некорректно работает с кириллицей, поэтому для русских корней
  // не ставим \b — ищем подстроки. Для латинских ключевых слов оставляем \b.
  const hasCode = /(код|ошибк|исключени)/i.test(t)
    || /\b(code|function|class|bug|exception|stack ?trace|typescript|javascript|python|sql|api|endpoint)\b/i.test(t)
    || /```/.test(userText)
    || /^\s*(import|from|const|let|var|function|def|class)\b/m.test(userText);
  const looksResearch = /(найди|найти|поиск|сравни|источник|новост|статьи?|кто такой|что такое)/i.test(t)
    || /\b(recent|latest|news|article|google|search)\b/i.test(t);
  const looksAnalyze = /(проанализир|разбери|разобрат|оцени|сделай разбор|метрик|логи?)/i.test(t)
    || /\b(analyze|analyse|metrics|breakdown)\b/i.test(t);
  // Корни: выбр (выбрать/выбор), вариант, стратеги, план, решени, рекоменд,
  // плюс «что лучше» и «стоит ли».
  const looksStrategy = /(стратеги|план|вариант|решени|выбр|выбор|рекоменд|что лучше|стоит ли|должен ли|посовет)/i.test(t)
    || /\b(strategy|plan|recommend|tradeoff|trade-off)\b/i.test(t);

  let category: TaskCategory = "quick";
  if (hasCode) category = "code";
  else if (looksStrategy) category = "strategy";
  else if (looksResearch) category = "research";
  else if (looksAnalyze) category = "analyze";
  else if (t.length > 280) category = "analyze";

  const complexity: Complexity = t.length < 80 ? "low" : t.length < 400 ? "medium" : "high";
  return { category, complexity, reason: "эвристика (роутер недоступен)" };
}

// ─── Основная точка входа ───────────────────────────────────────────

export interface RouteInput {
  mode: ChatMode;
  userText: string;
  /** Если задано — пользователь явно выбрал модель в чате, авто-выбор отключён. */
  overrideModel?: string | null;
  /** Есть ли в сообщении картинки — влияет на выбор модели. */
  multimodalNeeded?: boolean;
  /** Последние реплики истории (компактно) — помогают классификатору. */
  recentHistory?: string;
}

export async function routeRequest(input: RouteInput): Promise<RoutingDecision> {
  const t0 = Date.now();
  const { mode, userText, overrideModel, multimodalNeeded = false } = input;

  // 1. Override — пользователь явно выбрал модель в этом чате.
  if (overrideModel && isKnownModel(overrideModel)) {
    const opt = getModelOption(overrideModel);
    // Подбираем категорию для system-аддона эвристикой — без сетевого запроса
    // (override означает «я знаю что делаю», не тратим Flash зря).
    const h = heuristicClassify(userText);
    const tuned = tuneForMode(
      {
        model: overrideModel,
        max_tokens: mode === "pro" ? 8000 : 4000,
        reasoning_effort: undefined,
      },
      mode,
    );
    return {
      model: overrideModel,
      category: h.category,
      complexity: h.complexity,
      mode,
      max_tokens: tuned.max_tokens,
      reasoning_effort: tuned.reasoning_effort,
      system_addon: SYSTEM_ADDONS[h.category],
      source: "override",
      reason: `вручную выбрана ${opt.label}`,
      routing_latency_ms: 0,
      uncertain: false,
    };
  }

  // 2. Авто-роутер.
  const classification = await classify(userText, input.recentHistory ?? "");
  const t1 = Date.now();
  const cls = classification ?? heuristicClassify(userText);
  const source: RoutingDecision["source"] = classification ? "auto" : "fallback";

  const basePick = pickModelFor(cls.category, mode, multimodalNeeded);
  const tuned = tuneForMode(basePick, mode);
  const opt = getModelOption(tuned.model);

  return {
    model: tuned.model,
    category: cls.category,
    complexity: cls.complexity,
    mode,
    max_tokens: tuned.max_tokens,
    reasoning_effort: tuned.reasoning_effort,
    system_addon: SYSTEM_ADDONS[cls.category],
    source,
    reason: classification
      ? `${opt.label} · ${labelForCategory(cls.category)}`
      : `${opt.label} · ${labelForCategory(cls.category)} (эвристика)`,
    routing_latency_ms: t1 - t0,
    uncertain: !classification,
  };
}

function labelForCategory(c: TaskCategory): string {
  return {
    quick: "быстрый",
    research: "ресёрч",
    code: "код",
    analyze: "анализ",
    strategy: "стратегия",
  }[c];
}

// ─── Утилита: компактная история для классификатора ────────────────
//
// Берём последние N реплик, обрезаем длинное содержимое. Цель — дать
// классификатору контекст («это продолжение разговора про X»), не сжигая
// токены Flash.

export function compactRecentHistory(
  msgs: Array<{ role: string; content: string }>,
  takeLast = 4,
  perMsgChars = 240,
): string {
  const tail = msgs.slice(-takeLast);
  return tail
    .map((m) => `${m.role}: ${m.content.slice(0, perMsgChars)}${m.content.length > perMsgChars ? "…" : ""}`)
    .join("\n");
}
