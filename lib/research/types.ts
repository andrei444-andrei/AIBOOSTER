// Типы модуля глубоких исследований. Модель данных рассчитана на дерево
// произвольной глубины (best-first с backtracking, фаза 2), хотя MVP работает
// «плоско» (глубина 1) — поэтому здесь уже есть parent_id/depth/scores.

export type RunStatus = "pending" | "running" | "done" | "error";
// open — узел в очереди; searching — захвачен в работу (защита от двойного взятия);
// expanded — раскрыт; exhausted — раскрыт, но пусто; error — упал.
export type NodeStatus = "open" | "searching" | "expanded" | "exhausted" | "error";
export type NodeKind = "root" | "question";
export type Direction = "positive" | "negative" | "mixed" | "unclear";
export type SearchProvider = "exa" | "tavily" | "perplexity";

export interface ResearchParams {
  maxDepth: number; // 0 = только корень; 1 = корень + под-вопросы (MVP); >1 = дерево
  fanout: number; // сколько под-вопросов генерируем на раскрытии
  maxNodes: number; // потолок раскрытых узлов (бюджет)
  maxCostUsd: number; // потолок стоимости прогона (бюджет)
  searchResults: number; // сколько результатов запрашиваем у поиска
  reasoningModel: string; // планировщик / judge / синтез
  extractModel: string; // извлечение факторов (дешевле)
  searchModel: string; // модель поиска для провайдера perplexity (sonar)
  searchProvider: SearchProvider;
}

export interface RunStats {
  nodesExpanded: number;
  findings: number; // новых факторов добавлено в реестр
  searches: number;
  costUsd: number;
  ticks: number;
}

export interface NodeScores {
  relevance: number; // 0..1 — относится ли ветка к цели
  novelty: number; // 0..1 — доля НОВЫХ факторов относительно реестра
  evidence: number; // 0..1 — сила доказательств
  promise: number; // 0..1 — стоит ли копать глубже (используется фронтиром в фазе 2)
}

export interface SearchSource {
  title: string;
  url: string;
  snippet: string;
  date?: string | null;
}

export interface RunRow {
  id: string;
  goal: string;
  status: RunStatus;
  params: ResearchParams;
  stats: RunStats;
  report: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface NodeRow {
  id: string;
  run_id: string;
  parent_id: string | null;
  depth: number;
  kind: NodeKind;
  question: string;
  status: NodeStatus;
  query: string | null;
  sources: SearchSource[];
  summary: string | null;
  scores: NodeScores | null;
  decision: string | null;
  rationale: string | null;
  cost_usd: number;
  created_at: string;
  updated_at: string;
}

export interface FindingRow {
  id: string;
  run_id: string;
  factor: string;
  description: string;
  direction: Direction;
  confidence: number;
  evidence: string[];
  sources: SearchSource[];
  node_ids: string[];
  mentions: number;
  created_at: string;
  updated_at: string;
}

// Один атомарный фактор, извлечённый из материала (до укладки в реестр).
export interface ExtractedFactor {
  factor: string;
  description: string;
  direction: Direction;
  evidence: string;
  confidence: number;
}
