import type { ItemWithSource } from "./news";

export function serializeItem(it: ItemWithSource) {
  return {
    id: it.id,
    source: { id: it.source_id, name: it.source_name, kind: it.source_kind, url: it.source_url },
    external_id: it.external_id,
    url: it.url,
    title: it.title,
    body: it.body,
    published_at: it.published_at,
    summary: it.summary,
    value_explanation: it.value_explanation,
    matched_topics: parseJsonArray(it.matched_topics_json),
    relevance: it.relevance,
    verdict: it.verdict,
    reasoning: it.reasoning,
    model_used: it.model_used,
    validated_at: it.validated_at,
    created_at: it.created_at,
    status: it.status,
    validation_input: it.validation_input,
    validation_output_json: it.validation_output_json,
    validation_error: it.validation_error,
  };
}

export function parseJsonArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
