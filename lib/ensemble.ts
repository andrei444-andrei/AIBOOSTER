// Ensemble + Judge: §4 конституции — «качество > экономия».
//
// На каждый non-quick / non-image запрос параллельно дёргаем 2-3 модели,
// потом «судья» (GPT-5 high) синтезирует один финальный ответ из их кандидатов.
//
// Латентность: max(candidate_times) + judge_time ≈ 25-35с на категорию.
// Токены: ~4× от обычного. Бюджет позволяет.
//
// Контракт SSE-событий описан в PR #25 (фронт уже их обрабатывает):
//   ensemble_start { models }
//   candidate_done { model, duration_ms, tokens }
//   candidate_error { model, message }
//   judge_start { model }
//   delta { text }            ← токены судьи, как обычно
//   done { route: RouteMeta }  ← route_meta.ensemble=true, candidates, judge

import {
  MODELS,
  chat,
  chatStream,
  AIError,
  normalizeCitation,
  normalizeImage,
  type ChatMessage,
  type ChatOptions,
  type WebCitation,
  type WebImage,
} from "./ai";
import { getModelOption, type TaskCategory } from "./chat-client";
import { logServerError } from "./logger";
import { SONAR_ENGLISH_SYSTEM, translateQueryToEnglish } from "./pipeline";

// ─── Конфигурация ансамблей ─────────────────────────────────────────

/** Какие 2-4 модели запускать параллельно для каждой категории.
 *  null — категория не ансамблируется (quick — одна модель, image — другой пайплайн).
 *
 *  Sonar присутствует в КАЖДОМ ансамбле — даёт свежие данные из веба:
 *  reasoning-модели работают по памяти и не видят актуальные цены,
 *  релизы, метрики, новости. Sonar закрывает это слепое пятно. */
export const ENSEMBLES: Record<TaskCategory, string[] | null> = {
  quick: null,
  research: [MODELS.PERPLEXITY_SONAR, MODELS.CLAUDE_OPUS, MODELS.GEMINI_PRO, MODELS.GPT_5],
  code: [MODELS.PERPLEXITY_SONAR, MODELS.CLAUDE_OPUS, MODELS.DEEPSEEK_R1, MODELS.GPT_5],
  analyze: [MODELS.PERPLEXITY_SONAR, MODELS.GEMINI_PRO, MODELS.CLAUDE_OPUS, MODELS.GPT_5],
  strategy: [MODELS.PERPLEXITY_SONAR, MODELS.GPT_5, MODELS.CLAUDE_OPUS, MODELS.DEEPSEEK_R1],
  image: null,
};

export const JUDGE_MODEL = MODELS.GPT_5;
export const JUDGE_REASONING_EFFORT = "high" as const;
export const JUDGE_MAX_TOKENS = 16000;

/** Базовые правила судьи — действуют для всех категорий. К ним
 *  добавляется category-specific блок из JUDGE_FORMAT_BY_CATEGORY. */
const JUDGE_BASE_SYSTEM = `Тебе даны N независимых ответов разных моделей на один вопрос пользователя.
Твоя задача — выдать ОДИН лучший финальный ответ, синтезируя сильные стороны каждого.

ГЛАВНЫЙ ПРИНЦИП — глубина и факты:
- Если у кого-то из кандидатов есть конкретные ЦИФРЫ, ДАТЫ, ИМЕНА, ВЕРСИИ, ЦИТАТЫ, URL — все они должны попасть в финальный ответ. Не теряй фактуру.
- НЕ сокращай. Финал должен быть так же глубок, как самый подробный кандидат, или глубже.
- НЕ заменяй чужие таблицы своими более короткими списками. Если хоть один кандидат дал таблицу — финал тоже даёт таблицу (расширенную, не сжатую).

Правила синтеза:
1. Факты — кросс-валидируй. При расхождении выбирай того кандидата, у кого есть источник или конкретика, а не общие слова.
2. Структура — выбирай САМУЮ ИНФОРМАТИВНУЮ форму под содержимое (заголовки, таблицы GFM, списки, **жирный** для ключевых сущностей). Не ленись делать таблицы там, где они уместны.
3. Источники — **СТРОГО ОБЯЗАТЕЛЬНО**. Если у кандидата есть блок «ИСТОЧНИКИ КАНДИДАТА N (URL'ы по номерам)», ты ОБЯЗАН:
   а) Вшить эти URL **inline** прямо в текст в формате \`[короткое название](URL)\` рядом с фактом, который оттуда взят. Не в конце предложения — а в той самой фразе, где приводится цифра/имя/дата.
   б) Внутри таблиц добавить колонку «Источник» с кликабельной ссылкой \`[название](url)\` для каждой строки данных, либо ставить \`[\\[1\\]](url)\` после ячейки.
   в) В САМОМ КОНЦЕ ответа — раздел \`## Источники\` или \`**Источники:**\` с нумерованным списком всех использованных URL.
   г) НЕ пиши маркеры \`[1]\` без ссылки. Если упомянул номер — обязательно сделай его кликабельным \`[\\[1\\]](url)\`.
4. Галлюцинации — выкидывай. Слабо обоснованные утверждения — тоже.
5. НЕ пиши «Модель A сказала X», «По мнению нескольких моделей», «Большинство моделей считают». Выдай бесшовный ответ, как от одной сильной модели.
6. ЗАПРЕЩЕНО начинать ответ с ярлыков «Короткий ответ:», «TL;DR:», «Кратко:», «Резюме:», «В двух словах:». Начинай сразу с сути — фактом, цифрой, тезисом, заголовком или таблицей. Никаких подводок.
7. Тон — сохрани от вопроса (формальный/разговорный).
8. Язык — язык пользователя.

Выдавай ТОЛЬКО финальный ответ. Без мета-болтовни про «вот синтез», без «надеюсь, помог».`;

/** Категория-специфичные правила формата финального ответа. */
const JUDGE_FORMAT_BY_CATEGORY: Record<TaskCategory, string> = {
  quick: "", // не используется — для quick ансамбль не запускается
  research: `Категория — РЕСЁРЧ (факты про реальный мир).
- Если в вопросе есть сравнение / несколько вариантов / параметры — обязательно ТАБЛИЦА GFM ( | колонка | колонка | ).
- Если несколько аспектов — заголовки ## или ###, каждый раздел самостоятелен.
- Бренды, версии, даты, цены — **жирным**.
- В конце ответа — раздел «Источники» с перечнем URL и/или названий, упомянутых кандидатами. Не пропускай ни одну ссылку.
- Объём: если самый длинный кандидат больше 400 слов — финал такой же или больше. Не урезай.`,
  code: `Категория — КОД.
- Сначала готовое решение в блоке \`\`\`<язык> … \`\`\`.
- Если у кандидатов разные варианты (разные диалекты SQL, разные подходы, разные библиотеки) — покажи ВСЕ варианты, не выбирай произвольно один.
- После кода — короткое объяснение ключевых мест и edge cases, если их подняли кандидаты.`,
  analyze: `Категория — АНАЛИЗ.
- Раздели заголовками: «Что в данных» → «Выводы» → «Риски» → «Следующие шаги».
- Все цифры и метрики, упомянутые кандидатами, переноси в финал — числа важнее общих фраз.`,
  strategy: `Категория — СТРАТЕГИЯ.
- 2-3 варианта решения. Для каждого — pro/con, лучше таблицей.
- В конце — явная РЕКОМЕНДАЦИЯ с обоснованием. Не уклоняйся от выбора.
- Если у кандидатов разные рекомендации — отметь это явно и выбери наиболее обоснованную.`,
  image: "", // не используется
};

export function buildJudgeSystem(category: TaskCategory): string {
  const extra = JUDGE_FORMAT_BY_CATEGORY[category];
  return extra ? `${JUDGE_BASE_SYSTEM}\n\n${extra}` : JUDGE_BASE_SYSTEM;
}

/** Сохраняем для тестов и для возможного экспорта — оставлен как полный
 *  текст «универсального» промта судьи (для категорий, где специфики нет). */
export const JUDGE_SYSTEM = JUDGE_BASE_SYSTEM;

/** Лимит на размер сохраняемого ответа кандидата в route_meta (символы).
 *  Полная строка route_meta потом сериализуется в TEXT-колонку chat_messages;
 *  держим ниже ~200КБ суммарно (3 × 50КБ = 150КБ + обвязка). */
const MAX_CANDIDATE_RESPONSE_CHARS = 50_000;

// ─── Типы результата ────────────────────────────────────────────────

export interface CandidateResult {
  model: string;
  duration_ms: number;
  tokens: number;
  response: string;
  /** URL-источники, на которые ссылался кандидат (Perplexity Sonar и подобные). */
  citations?: WebCitation[];
  /** Картинки от веб-поиска. */
  images?: WebImage[];
  /** Если задано — кандидат упал, response пустой, судья работал без него. */
  error?: string;
}

export interface JudgeMeta {
  model: string;
  duration_ms: number;
  tokens: number;
}

export interface RunEnsembleResult {
  judgeText: string;
  candidates: CandidateResult[];
  judge: JudgeMeta;
  total_duration_ms: number;
  /** Все ли кандидаты упали — тогда судья не запускался. */
  allFailed: boolean;
}

// ─── Хендлеры (стрим во внешний SSE-канал) ─────────────────────────

export interface EnsembleHandlers {
  onEnsembleStart?: (models: string[]) => void;
  onCandidateDone?: (model: string, duration_ms: number, tokens: number) => void;
  onCandidateError?: (model: string, message: string) => void;
  onJudgeStart?: (model: string) => void;
  onJudgeDelta?: (text: string) => void;
  onJudgeUsage?: (usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  }) => void;
}

// ─── Опции ──────────────────────────────────────────────────────────

export interface RunEnsembleOptions {
  /** Категория задачи — определяет category-specific блок в промте судьи. */
  category: TaskCategory;
  /** Список model-id для параллельного дёрганья — обычно ENSEMBLES[category]. */
  models: string[];
  /** Билдер сообщений для конкретной модели — учитывает multimodal/non-multimodal,
   *  систем-промт и историю. Обычно это buildMessagesForModel(systemPrompt, history, model). */
  buildMessages: (modelId: string) => Array<{ role: string; content: unknown }>;
  /** Исходный текст вопроса (последняя реплика user) — попадает в промт судьи. */
  originalUserText: string;
  /** max_tokens для каждого кандидата — берём из route (chat_category_routing). */
  candidateMaxTokens: number;
  signal?: AbortSignal;
}

// ─── Главная точка входа ────────────────────────────────────────────

export async function runEnsemble(
  opts: RunEnsembleOptions,
  handlers: EnsembleHandlers = {},
): Promise<RunEnsembleResult> {
  const { category, models, buildMessages, originalUserText, candidateMaxTokens, signal } = opts;
  if (models.length === 0) {
    throw new Error("ensemble: empty models list");
  }

  const t0 = Date.now();
  handlers.onEnsembleStart?.(models);

  // ── Параллельно дёргаем всех кандидатов через Promise.allSettled.
  //   AIMLAPI временами 500-ит на отдельных моделях — теряем кандидата, но
  //   не валим весь ансамбль. Если упали все — выкидываем allFailed.
  const candidates = await Promise.all(
    models.map((model) =>
      runCandidate(model, buildMessages(model), originalUserText, candidateMaxTokens, signal, handlers),
    ),
  );

  const alive = candidates.filter((c) => !c.error);
  if (alive.length === 0) {
    return {
      judgeText: "",
      candidates: trimCandidatesForStorage(candidates),
      judge: { model: JUDGE_MODEL, duration_ms: 0, tokens: 0 },
      total_duration_ms: Date.now() - t0,
      allFailed: true,
    };
  }

  // ── Судья: стримом, чтобы клиент видел токены в реальном времени.
  handlers.onJudgeStart?.(JUDGE_MODEL);
  const tj = Date.now();
  const judgeUser = buildJudgeUserMessage(originalUserText, alive);
  const judgeMessages: ChatMessage[] = [
    { role: "system", content: buildJudgeSystem(category) },
    { role: "user", content: judgeUser },
  ];
  const judgeOpts: ChatOptions = {
    model: JUDGE_MODEL,
    messages: judgeMessages,
    max_tokens: JUDGE_MAX_TOKENS,
    reasoning_effort: JUDGE_REASONING_EFFORT,
  };

  let judgeTokens = 0;
  const judgeText = await chatStream(
    judgeOpts,
    {
      onDelta: (t) => handlers.onJudgeDelta?.(t),
      onUsage: (u) => {
        judgeTokens = u.completion_tokens;
        handlers.onJudgeUsage?.(u);
      },
    },
    { signal },
  );

  const judge_duration_ms = Date.now() - tj;

  return {
    judgeText,
    candidates: trimCandidatesForStorage(candidates),
    judge: { model: JUDGE_MODEL, duration_ms: judge_duration_ms, tokens: judgeTokens },
    total_duration_ms: Date.now() - t0,
    allFailed: false,
  };
}

// ─── Внутренние утилиты ─────────────────────────────────────────────

async function runCandidate(
  model: string,
  messages: Array<{ role: string; content: unknown }>,
  originalUserText: string,
  baseMaxTokens: number,
  signal: AbortSignal | undefined,
  handlers: EnsembleHandlers,
): Promise<CandidateResult> {
  const t = Date.now();
  try {
    // Sonar (Perplexity): подменяем messages на упрощённый английский запрос.
    // Качество поиска вырастет — английский веб шире и чище. Ответ Sonar
    // придёт по-английски, дальше судья переведёт в язык пользователя.
    let actualMessages = messages;
    if (model.startsWith("perplexity/")) {
      const { english } = await translateQueryToEnglish(originalUserText, signal);
      actualMessages = [
        { role: "system", content: SONAR_ENGLISH_SYSTEM },
        { role: "user", content: english },
      ];
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reqOpts: any = {
      model,
      messages: actualMessages,
      max_tokens: baseMaxTokens,
    };
    // GPT-5 в ансамбле всегда reasoning_effort=high — §4 «качество > экономия».
    // Для DeepSeek R1 reasoning_effort не задаём — пусть идёт дефолт.
    if (model.startsWith("gpt-5")) {
      reqOpts.reasoning_effort = "high";
    }
    // Perplexity Sonar: запрашиваем картинки/цитаты — через non-stream API
    // они приходят в самом ответе.
    if (model.startsWith("perplexity/")) {
      reqOpts.return_images = true;
      reqOpts.return_related_questions = false;
    }

    const r = await chat(reqOpts, { signal });
    const duration_ms = Date.now() - t;
    const response = r.choices?.[0]?.message?.content ?? "";
    const tokens = r.usage?.completion_tokens ?? 0;
    if (!response || !response.trim()) {
      throw new Error(`empty content (finish=${r.choices?.[0]?.finish_reason ?? "?"})`);
    }
    // Веб-источники и картинки от поисковых моделей (Perplexity Sonar): в
    // non-stream ответе AIMLAPI они лежат на верхнем уровне как `citations`
    // / `search_results` / `images`. Дедуп и нормализация — общими утилитами.
    const rawCits = Array.isArray(r.citations)
      ? r.citations
      : Array.isArray(r.search_results)
        ? r.search_results
        : [];
    const seenCit = new Set<string>();
    const citations: WebCitation[] = [];
    for (const c of rawCits) {
      const n = normalizeCitation(c);
      if (!n || seenCit.has(n.url)) continue;
      seenCit.add(n.url);
      citations.push(n);
    }
    const rawImgs = Array.isArray(r.images) ? r.images : [];
    const seenImg = new Set<string>();
    const images: WebImage[] = [];
    for (const img of rawImgs) {
      const n = normalizeImage(img);
      if (!n || seenImg.has(n.image_url)) continue;
      seenImg.add(n.image_url);
      images.push(n);
    }
    handlers.onCandidateDone?.(model, duration_ms, tokens);
    return { model, duration_ms, tokens, response, citations, images };
  } catch (err) {
    const duration_ms = Date.now() - t;
    const message = err instanceof Error ? err.message : String(err);
    // Логируем падение кандидата в app_errors — без этого root cause
    // приходится воспроизводить вручную, как было с Perplexity 400.
    // Мягкий fire-and-forget: ошибка лога не должна валить ансамбль.
    const body = err instanceof AIError ? err.body : undefined;
    logServerError(err, "ensemble:candidate", {
      model,
      duration_ms,
      api_status: err instanceof AIError ? err.status : undefined,
      api_body: body ? body.slice(0, 800) : undefined,
    }).catch(() => {});
    handlers.onCandidateError?.(model, message);
    return { model, duration_ms, tokens: 0, response: "", error: message };
  }
}

function buildJudgeUserMessage(original: string, candidates: CandidateResult[]): string {
  const parts: string[] = [];
  parts.push(`ВОПРОС ПОЛЬЗОВАТЕЛЯ:\n${original}\n`);
  candidates.forEach((c, i) => {
    const label = getModelOption(c.model).label;
    parts.push(`ОТВЕТ КАНДИДАТА ${i + 1} (${label}):\n${c.response}\n`);
    if (c.citations && c.citations.length > 0) {
      // Подсовываем судье карту [N] → URL, чтобы он мог встроить ссылки
      // прямо в текст вместо безымянных [1] [2] маркеров кандидата.
      const lines = c.citations.map(
        (src, j) =>
          `[${j + 1}] ${src.title ? `${src.title.replace(/\s+/g, " ").trim()} — ` : ""}${src.url}`,
      );
      parts.push(`ИСТОЧНИКИ КАНДИДАТА ${i + 1} (URL'ы по номерам):\n${lines.join("\n")}\n`);
    }
  });
  parts.push(`Финальный ответ:`);
  return parts.join("\n");
}

/** Подрезаем длинные ответы перед сохранением в route_meta — чтобы строка
 *  не разрослась за лимит на сообщение. На судье уже отработали — для UI
 *  достаточно усечённой версии. */
function trimCandidatesForStorage(candidates: CandidateResult[]): CandidateResult[] {
  return candidates.map((c) => {
    if (c.response.length <= MAX_CANDIDATE_RESPONSE_CHARS) return c;
    return {
      ...c,
      response:
        c.response.slice(0, MAX_CANDIDATE_RESPONSE_CHARS) +
        `\n\n[…ответ усечён, всего ${c.response.length} символов]`,
    };
  });
}
