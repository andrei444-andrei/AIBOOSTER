// Общие типы модуля «Адаптеры».
//
// Сами адаптеры (Gmail/Notion/Slack/Telegram/GCal) живут в lib/adapters/<kind>.ts
// и реализуют Adapter<Creds, Cursor>. Здесь — только контракт и общие enum'ы,
// чтобы движок (tick/claim/update) был агностичен к источникам.

export type AdapterKind = "gmail" | "notion" | "slack" | "telegram" | "gcal";

export type SourceStatus = "idle" | "syncing" | "error" | "disabled";

export type JobKind = "pull" | "embed";
export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface AdapterSourceRow {
  id: string;
  kind: AdapterKind;
  display_name: string | null;
  status: SourceStatus;
  credentials: string | null; // JSON; парсится адаптером
  cursor: string | null;      // JSON; формат свой у каждого адаптера
  interval_sec: number;
  last_run_at: string | null;
  next_run_at: string | null;
  last_error: string | null;
  last_error_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdapterSyncJobRow {
  id: string;
  source_id: string;
  kind: AdapterKind;
  job_kind: JobKind;
  status: JobStatus;
  progress: number;
  fetched_count: number;
  stats: string | null;
  error_message: string | null;
  error_id: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

// Контракт адаптера. Конкретные адаптеры реализуют его в lib/adapters/<kind>.ts
// и регистрируются в lib/adapters/registry.ts. Движок (claim/update в воркере)
// дёргает только sync() — всё OAuth/refresh адаптер делает внутри.
//
// Параметризован двумя generic'ами:
//   Creds — форма JSON в adapter_sources.credentials
//   Cursor — форма JSON в adapter_sources.cursor
export interface SyncResult<Cursor, Creds = unknown> {
  newCursor: Cursor;
  fetched: number;
  stats?: Record<string, unknown>;
  // Если адаптер обновил свои credentials (рефреш OAuth access_token, ротация
  // секрета и т.п.) — возвращает их сюда, runner запишет в БД. Если undefined —
  // ничего не меняем.
  newCreds?: Creds;
}

export interface SyncArgs<Creds, Cursor> {
  sourceId: string;
  creds: Creds;
  cursor: Cursor | null;
  onProgress?: (n: number) => void;
}

export interface Adapter<Creds = unknown, Cursor = unknown> {
  kind: AdapterKind;
  defaultIntervalSec: number;

  // Pull-цикл. Может выполняться долго; воркер шлёт прогресс через onProgress.
  // Должен быть идемпотентным относительно cursor'а: если cursor совпадает, и
  // ничего нового нет — возвращает { fetched: 0, newCursor: cursor ?? initial }.
  sync(args: SyncArgs<Creds, Cursor>): Promise<SyncResult<Cursor, Creds>>;
}
