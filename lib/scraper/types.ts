/** Финальные и промежуточные статусы запуска scraper. */
export type ScraperStatus =
  | "pending" // создан, ещё не начали
  | "planning" // LLM генерирует код
  | "running" // отправили в Apify, ждём
  | "summarizing" // данные собраны, LLM пишет отчёт
  | "succeeded"
  | "failed";

export interface ScraperRunRow {
  id: string;
  created_at: string;
  updated_at: string;
  prompt: string;
  status: ScraperStatus;
  apify_run_id: string | null;
  apify_dataset_id: string | null;
  result_count: number | null;
  result_summary: string | null;
  error_id: string | null;
  error_message: string | null;
}

export interface ScraperAttemptRow {
  id: string;
  run_id: string;
  created_at: string;
  n: number;
  code: string;
  reasoning: string | null;
  apify_run_id: string | null;
  items_count: number | null;
  error: string | null;
}

/** То, что LLM возвращает на этапе генерации кода. */
export interface CodeGenResult {
  reasoning: string;
  code: string;
}

/** То, что отдаём на фронт в /api/scraper/runs/[id]. */
export interface ScraperRunView extends ScraperRunRow {
  attempts: ScraperAttemptRow[];
  /** Сэмпл первых N элементов датасета — для предпросмотра в UI. */
  items_preview?: unknown[];
}
