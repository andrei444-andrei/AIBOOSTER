// Извлечение атомарных факторов из найденного материала и оценка ветки (судья).

import { chatJSON, type Usage } from "./llm";
import { extractMessages, judgeMessages } from "./prompts";
import type { Direction, ExtractedFactor, SearchSource } from "./types";

export interface ExtractResult {
  factors: ExtractedFactor[];
  usage: Usage;
}

export async function extractFactors(
  goal: string,
  question: string,
  material: string,
  sources: SearchSource[],
  model: string,
): Promise<ExtractResult> {
  const { data, usage } = await chatJSON<{ factors?: unknown[] }>({
    model,
    temperature: 0,
    maxTokens: 1500,
    messages: extractMessages(goal, question, material, sources),
  });
  const factors = (data.factors ?? [])
    .map(normalizeFactor)
    .filter((f): f is ExtractedFactor => f !== null);
  return { factors, usage };
}

export interface JudgeResult {
  relevance: number;
  evidence: number;
  promise: number;
  decision: "deepen" | "stop";
  reasoning: string;
  usage: Usage;
}

export async function judgeNode(
  goal: string,
  question: string,
  factorNames: string[],
  totalFound: number,
  newFound: number,
  model: string,
): Promise<JudgeResult> {
  const { data, usage } = await chatJSON<{
    relevance?: number;
    evidence?: number;
    promise?: number;
    decision?: string;
    reasoning?: string;
  }>({
    model,
    temperature: 0,
    maxTokens: 400,
    messages: judgeMessages(goal, question, factorNames, totalFound, newFound),
  });
  return {
    relevance: cl01(data.relevance),
    evidence: cl01(data.evidence),
    promise: cl01(data.promise),
    decision: data.decision === "deepen" ? "deepen" : "stop",
    reasoning: typeof data.reasoning === "string" ? data.reasoning : "",
    usage,
  };
}

const DIRECTIONS: Direction[] = ["positive", "negative", "mixed", "unclear"];

function normalizeFactor(raw: unknown): ExtractedFactor | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const factor = typeof o.factor === "string" ? o.factor.trim() : "";
  if (!factor) return null;
  const dir = typeof o.direction === "string" ? (o.direction as Direction) : "unclear";
  return {
    factor,
    description: typeof o.description === "string" ? o.description : "",
    direction: DIRECTIONS.includes(dir) ? dir : "unclear",
    evidence: typeof o.evidence === "string" ? o.evidence : "",
    confidence: cl01(o.confidence),
  };
}

function cl01(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), 1);
}
