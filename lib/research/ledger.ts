// Реестр находок: укладывает извлечённые факторы в research_findings с дедупом.
// MVP-дедуп — по нормализованному имени (без ложных слияний). Семантическое
// объединение алиасов делает финальный синтез (а позже — эмбеддинги, фаза 2/3).

import { getFindingByNorm, insertFinding, updateFinding } from "./store";
import type { ExtractedFactor, SearchSource } from "./types";

export interface MergeResult {
  inserted: number; // новых факторов (мера новизны ветки)
  merged: number; // совпавших с уже известными
}

export async function mergeFindings(
  runId: string,
  nodeId: string,
  factors: ExtractedFactor[],
  sources: SearchSource[],
): Promise<MergeResult> {
  let inserted = 0;
  let merged = 0;

  for (const f of factors) {
    const norm = normalizeName(f.factor);
    if (!norm) continue;

    const existing = await getFindingByNorm(runId, norm);
    if (existing) {
      await updateFinding(existing.id, {
        description: existing.description || f.description,
        confidence: Math.max(existing.confidence, f.confidence),
        evidence: dedupeStrings(
          [...existing.evidence, f.evidence].filter(Boolean),
        ).slice(0, 8),
        sources: dedupeSources([...existing.sources, ...sources]).slice(0, 12),
        node_ids: Array.from(new Set([...existing.node_ids, nodeId])),
        mentions: existing.mentions + 1,
      });
      merged++;
    } else {
      await insertFinding({
        run_id: runId,
        factor: f.factor,
        factor_norm: norm,
        description: f.description,
        direction: f.direction,
        confidence: f.confidence,
        evidence: f.evidence ? [f.evidence] : [],
        sources,
        node_ids: [nodeId],
      });
      inserted++;
    }
  }

  return { inserted, merged };
}

// Нормализация имени фактора для дедупа: нижний регистр, убрать пунктуацию,
// схлопнуть пробелы. Поддерживает кириллицу и латиницу.
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function dedupeStrings(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

function dedupeSources(arr: SearchSource[]): SearchSource[] {
  const seen = new Set<string>();
  const out: SearchSource[] = [];
  for (const s of arr) {
    const key = s.url || s.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
