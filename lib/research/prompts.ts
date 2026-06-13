// Все промпты модуля в одном месте. Поля для человека (description, reasoning,
// отчёт) — на языке цели; ключи JSON всегда английские, чтобы парс был стабильным.

import type { ChatMessage } from "./llm";
import type { ExtractedFactor, ResearchParams, SearchSource } from "./types";

export function planMessages(goal: string, params: ResearchParams): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "Ты — ведущий аналитик-исследователь. Ты декомпозируешь крупную " +
        "исследовательскую цель на конкретные, НЕпересекающиеся под-вопросы — " +
        "каждый проверяется отдельным веб-поиском. Цель — максимальный охват " +
        "зацепок: разные механизмы, школы мысли, классы факторов, а не 2–3 " +
        "очевидных. Отвечай ТОЛЬКО валидным JSON.",
    },
    {
      role: "user",
      content:
        `Цель исследования:\n${goal}\n\n` +
        `Сгенерируй ${params.fanout} разнообразных под-вопросов, покрывающих ` +
        `РАЗНЫЕ аспекты. Под-вопрос — на языке цели, формулируй как поисковый ` +
        `запрос/вопрос.\n\n` +
        `Формат:\n{"subquestions":[{"question":"...","angle":"чем этот угол отличается от других"}]}`,
    },
  ];
}

// Генерация более глубоких под-вопросов из перспективного узла (фаза 2: дерево).
export function childMessages(
  goal: string,
  parentQuestion: string,
  factors: ExtractedFactor[],
  params: ResearchParams,
): ChatMessage[] {
  const found = factors
    .slice(0, 12)
    .map((f) => `- ${f.factor}: ${f.description}`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        "Ты углубляешь исследование. На основе уже найденного на этой ветке " +
        "ты предлагаешь под-вопросы СЛЕДУЮЩЕГО уровня: уточнить механизм, " +
        "проверить причинность, найти смежные/противоположные факторы. " +
        "Не повторяй уже найденное. Отвечай ТОЛЬКО валидным JSON.",
    },
    {
      role: "user",
      content:
        `Цель:\n${goal}\n\nТекущий под-вопрос:\n${parentQuestion}\n\n` +
        `Уже найдено на ветке:\n${found || "(пусто)"}\n\n` +
        `Дай до ${params.fanout} более глубоких под-вопросов на языке цели.\n` +
        `Формат:\n{"subquestions":[{"question":"...","angle":"..."}]}`,
    },
  ];
}

export function extractMessages(
  goal: string,
  question: string,
  material: string,
  sources: SearchSource[],
): ChatMessage[] {
  const srcList = sources
    .slice(0, 12)
    .map((s, i) => `[${i + 1}] ${s.title || s.url} — ${s.url}`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        "Ты извлекаешь из найденного материала КОНКРЕТНЫЕ факторы/механизмы, " +
        "относящиеся к цели. Каждый фактор атомарный (одна сущность = один " +
        "фактор). Не выдумывай — опирайся только на материал. Отвечай ТОЛЬКО " +
        "валидным JSON.",
    },
    {
      role: "user",
      content:
        `Цель:\n${goal}\n\nПод-вопрос:\n${question}\n\n` +
        `Материал:\n${truncate(material, 6000)}\n\nИсточники:\n${srcList}\n\n` +
        `Извлеки факторы. direction — знак влияния на целевую метрику. ` +
        `evidence — конкретная зацепка/формулировка из материала. confidence 0..1.\n` +
        `Если материал нерелевантен — верни {"factors":[]}.\n\n` +
        `Формат:\n{"factors":[{"factor":"короткое имя","description":"1-2 предложения","direction":"positive|negative|mixed|unclear","evidence":"...","confidence":0.0}]}`,
    },
  ];
}

export function judgeMessages(
  goal: string,
  question: string,
  factorNames: string[],
  totalFound: number,
  newFound: number,
): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "Ты оцениваешь продуктивность ветки исследования и решаешь, стоит ли " +
        "копать глубже. Отвечай ТОЛЬКО валидным JSON.",
    },
    {
      role: "user",
      content:
        `Цель:\n${goal}\n\nПод-вопрос:\n${question}\n\n` +
        `Найдено факторов: ${totalFound}, из них новых для реестра: ${newFound}.\n` +
        `Список: ${factorNames.slice(0, 20).join(", ") || "(пусто)"}\n\n` +
        `Оцени по 0..1: relevance (относится ли ветка к цели), evidence (сила ` +
        `доказательств), promise (перспективность углубления именно здесь). ` +
        `decision: "deepen" если стоит копать глубже, иначе "stop". reasoning — ` +
        `1–2 предложения на языке цели.\n\n` +
        `Формат:\n{"relevance":0.0,"evidence":0.0,"promise":0.0,"decision":"deepen|stop","reasoning":"..."}`,
    },
  ];
}

export function synthesisMessages(
  goal: string,
  findingsBlock: string,
): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "Ты — старший аналитик. Пишешь финальный обзор по сырому реестру " +
        "найденных факторов: консолидируешь синонимы/алиасы, ранжируешь по " +
        "важности и силе доказательств, отмечаешь направление эффекта и " +
        "противоречия. Пиши на языке цели, в Markdown.",
    },
    {
      role: "user",
      content:
        `Цель:\n${goal}\n\nСырой реестр факторов (возможны дубли/алиасы):\n` +
        `${truncate(findingsBlock, 12000)}\n\n` +
        `Структура обзора:\n` +
        `1) Ключевые факторы — список/таблица: фактор, направление, уверенность, кратко доказательство.\n` +
        `2) Группировка по темам/механизмам.\n` +
        `3) Спорное/слабо подтверждённое.\n` +
        `4) Пробелы и что копать дальше.`,
    },
  ];
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "\n…[обрезано]" : s;
}
