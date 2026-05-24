// AI-роутер: на каждый запрос подбирает модель и параметры.
//
// Вход: текст последнего сообщения, опционально category-пресет или override-модель.
// Выход: RoutingDecision — какая модель, какие параметры, какой system-addon приклеить.
//
// Приоритеты:
// 1. overrideModel — пользователь явно выбрал модель в селекторе.
// 2. overrideCategory — пользователь явно выбрал категорию-пресет.
// 3. Авто-классификация через Gemini Flash (≤8с таймаут).
// 4. Эвристика по ключевым словам, если Flash недоступен.
//
// Параметры (model, reasoning_effort, max_tokens) для каждой категории
// берутся из таблицы chat_category_routing (редактируется в /admin/chat).

import { MODELS, chatText, AIError } from "./ai";
import {
  type TaskCategory,
  type ReasoningEffort,
  getModelOption,
  isKnownModel,
  CATEGORY_META,
} from "./chat-client";
import { getRoute } from "./routing-config";

export type Complexity = "low" | "medium" | "high";

export interface RoutingDecision {
  model: string;
  category: TaskCategory;
  complexity: Complexity;
  max_tokens: number;
  reasoning_effort: ReasoningEffort | null;
  /** Доп. инструкции к system-промту, специфичные для категории. */
  system_addon?: string;
  /** Как принято решение. */
  source: "override-model" | "override-category" | "auto" | "fallback";
  /** Короткая причина для UI. */
  reason: string;
  routing_latency_ms: number;
  /** Эвристика безопасности: классификация уверенная? */
  uncertain?: boolean;
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
  // image-категория не использует system addon — текст пользователя идёт
  // напрямую в image-gen API как prompt.
  image: "",
};

// ─── Авто-классификация через Gemini Flash ──────────────────────────

interface ClassifierOutput {
  category: TaskCategory;
  complexity: Complexity;
  reason: string;
}

const CLASSIFIER_SYSTEM = `Ты — классификатор задач для AI-чата. Получаешь последнее сообщение пользователя и краткий контекст. Возвращаешь СТРОГО JSON:
{"category": "<quick|research|code|analyze|strategy|image>", "complexity": "<low|medium|high>", "reason": "<до 80 символов на русском>"}

Категории:
- quick: короткий фактический вопрос, уточнение, перевод, определение
- research: «найди», «сравни источники», «что говорят про…», запрос на ссылки и факты
- code: написать/починить/объяснить код, debug, рефакторинг, ревью
- analyze: разобрать данные, документ, логи, дать выводы по предоставленному
- strategy: продумать варианты, принять решение, план, креатив, бизнес-выбор
- image: «нарисуй», «сгенерируй картинку», «изображение / фотография / иллюстрация / арт / постер X», просьба создать визуал

Complexity:
- low: можно ответить за 1–2 абзаца без глубокой работы
- medium: нужен структурированный ответ, несколько аспектов
- high: длинный ответ, много шагов рассуждения

Только JSON, никакого текста вокруг.`;

function extractJsonObject(s: string): string | null {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) {
    const inner = fence[1].trim();
    if (inner.startsWith("{")) return inner;
  }
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
        max_tokens: 1200,
        temperature: 0,
      },
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
    if (err instanceof AIError) {
      // молча
    }
    return null;
  }
}

function isCategory(v: unknown): v is TaskCategory {
  return (
    v === "quick" ||
    v === "research" ||
    v === "code" ||
    v === "analyze" ||
    v === "strategy" ||
    v === "image"
  );
}
function isComplexity(v: unknown): v is Complexity {
  return v === "low" || v === "medium" || v === "high";
}

// ─── Эвристический фолбэк ───────────────────────────────────────────

function heuristicClassify(userText: string): ClassifierOutput {
  const t = userText.toLowerCase();
  // Image-генерация: глагол создания + объект. Image-проверка идёт первой,
  // потому что «нарисуй стратегию выхода» — это про картинку, не про strategy.
  const looksImage = /(нарисуй|нарисует|сгенерируй картинк|сгенерируй изображени|сделай картинк|создай картинк|изображени[ея] |фотографи[ея] |иллюстрац|постер|обложк|логотип|арт|wallpaper)/i.test(t)
    || /\b(draw|generate (an?|the) image|picture of|image of|photo of|illustration of|render of|poster of)\b/i.test(t);
  const hasCode = /(код|ошибк|исключени)/i.test(t)
    || /\b(code|function|class|bug|exception|stack ?trace|typescript|javascript|python|sql|api|endpoint)\b/i.test(t)
    || /```/.test(userText)
    || /^\s*(import|from|const|let|var|function|def|class)\b/m.test(userText);
  const looksResearch = /(найди|найти|поиск|сравни|источник|новост|статьи?|кто такой|что такое)/i.test(t)
    || /\b(recent|latest|news|article|google|search)\b/i.test(t);
  const looksAnalyze = /(проанализир|разбери|разобрат|оцени|сделай разбор|метрик|логи?)/i.test(t)
    || /\b(analyze|analyse|metrics|breakdown)\b/i.test(t);
  const looksStrategy = /(стратеги|план|вариант|решени|выбр|выбор|рекоменд|что лучше|стоит ли|должен ли|посовет)/i.test(t)
    || /\b(strategy|plan|recommend|tradeoff|trade-off)\b/i.test(t);

  let category: TaskCategory = "quick";
  if (looksImage) category = "image";
  else if (hasCode) category = "code";
  else if (looksStrategy) category = "strategy";
  else if (looksResearch) category = "research";
  else if (looksAnalyze) category = "analyze";
  else if (t.length > 280) category = "analyze";

  const complexity: Complexity = t.length < 80 ? "low" : t.length < 400 ? "medium" : "high";
  return { category, complexity, reason: "эвристика (роутер недоступен)" };
}

// ─── Основная точка входа ───────────────────────────────────────────

export interface RouteInput {
  userText: string;
  /** Если задано — пользователь явно выбрал модель в селекторе. Приоритет 1. */
  overrideModel?: string | null;
  /** Если задано — пользователь явно выбрал категорию-пресет. Приоритет 2. */
  overrideCategory?: TaskCategory | null;
  /** Есть ли в сообщении картинки — влияет на выбор fallback-модели. */
  multimodalNeeded?: boolean;
  /** Последние реплики истории (компактно) — помогают классификатору. */
  recentHistory?: string;
}

export async function routeRequest(input: RouteInput): Promise<RoutingDecision> {
  const t0 = Date.now();
  const { userText, overrideModel, overrideCategory, multimodalNeeded = false } = input;

  // 1. Override model — пользователь явно выбрал модель.
  if (overrideModel && isKnownModel(overrideModel)) {
    const h = heuristicClassify(userText);
    // Параметры берём из таблицы для соответствующей категории,
    // но модель остаётся такой, как выбрал пользователь.
    const route = await getRoute(h.category);
    const opt = getModelOption(overrideModel);
    return {
      model: overrideModel,
      category: h.category,
      complexity: h.complexity,
      max_tokens: route.max_tokens,
      reasoning_effort: route.reasoning_effort,
      system_addon: SYSTEM_ADDONS[h.category],
      source: "override-model",
      reason: `вручную выбрана ${opt.label}`,
      routing_latency_ms: 0,
      uncertain: false,
    };
  }

  // 2. Override category — пользователь выбрал пресет.
  if (overrideCategory) {
    const route = await getRoute(overrideCategory);
    const model = pickModelWithMultimodal(route.model, multimodalNeeded);
    const opt = getModelOption(model);
    return {
      model,
      category: overrideCategory,
      complexity: "medium",
      max_tokens: route.max_tokens,
      reasoning_effort: route.reasoning_effort,
      system_addon: SYSTEM_ADDONS[overrideCategory],
      source: "override-category",
      reason: `${CATEGORY_META[overrideCategory].label} · ${opt.label}`,
      routing_latency_ms: 0,
      uncertain: false,
    };
  }

  // 3. Авто-классификация.
  const classification = await classify(userText, input.recentHistory ?? "");
  const t1 = Date.now();
  const cls = classification ?? heuristicClassify(userText);
  const source: RoutingDecision["source"] = classification ? "auto" : "fallback";

  const route = await getRoute(cls.category);
  const model = pickModelWithMultimodal(route.model, multimodalNeeded);
  const opt = getModelOption(model);

  return {
    model,
    category: cls.category,
    complexity: cls.complexity,
    max_tokens: route.max_tokens,
    reasoning_effort: route.reasoning_effort,
    system_addon: SYSTEM_ADDONS[cls.category],
    source,
    reason: classification
      ? `${opt.label} · ${CATEGORY_META[cls.category].label.toLowerCase()}`
      : `${opt.label} · ${CATEGORY_META[cls.category].label.toLowerCase()} (эвристика)`,
    routing_latency_ms: t1 - t0,
    uncertain: !classification,
  };
}

/** Если сообщение содержит картинку, а выбранная модель не multimodal,
 *  подменяем её на Sonnet 4.5 (multimodal-универсал). */
function pickModelWithMultimodal(model: string, multimodalNeeded: boolean): string {
  if (!multimodalNeeded) return model;
  const opt = getModelOption(model);
  if (opt.multimodal) return model;
  return MODELS.CLAUDE_SONNET;
}

// ─── Утилита: компактная история для классификатора ────────────────

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
