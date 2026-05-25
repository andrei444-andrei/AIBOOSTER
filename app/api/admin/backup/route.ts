import { NextResponse } from "next/server";
import { createClient, type Client, type InStatement, type InValue } from "@libsql/client/web";
import { getDb, ensureSchema } from "@/lib/db";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Канонический список таблиц, ради которых жалко терять данные при подмене
// прод-БД (см. CLAUDE.md §0 про standalone Turso). Пропускаем то, что
// дёшево восстанавливается автосинком (apify_actors, scraper_catalog) и
// что нет смысла снапшотить (app_errors — это и есть лог).
const CRITICAL_TABLES = [
  // Чат: вся пользовательская история и настройки модуля.
  "chat_sessions",
  "chat_messages",
  "chat_attachments",
  "chat_category_routing",
  "chat_settings",
  // Адаптеры: OAuth-токены к внешним источникам + пользовательские джобы.
  "adapter_sources",
  "adapter_sync_jobs",
  "adapter_sync_runs",
  // Контекст и Gmail: исторические данные и эмбеддинги (re-embed стоит денег).
  "context_snippets",
  "context_chunks",
  "gmail_messages",
  // Скрапер: история запусков и попыток (каталог скипаем — пересинкается).
  "scraper_runs",
  "scraper_attempts",
  // YouTube-перевод: задачи и сегменты (медиа на R2, тут только метаданные).
  "video_translation_jobs",
  "video_translation_segments",
];

// GET /api/admin/backup
// Снимок критичных таблиц прод-БД в standalone Turso (BACKUP_DATABASE_URL).
// Вызывается Vercel-cron раз в сутки (Authorization: Bearer ${CRON_SECRET})
// или вручную с ADMIN_TOKEN. Полный snapshot: содержимое таблицы в бэкапе
// замещается на содержимое из прода.
//
// Sanity-страховка: если источник пуст, а в бэкапе есть данные — перезапись
// этой таблицы отменяется. Это защита от db-swap, когда прод-БД молча
// заменили на пустую и иначе мы бы своими руками затёрли историю в бэкапе.
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const backupUrl = process.env.BACKUP_DATABASE_URL;
  const backupToken = process.env.BACKUP_AUTH_TOKEN;
  if (!backupUrl) {
    return NextResponse.json(
      { error: "BACKUP_DATABASE_URL is not configured" },
      { status: 503 },
    );
  }

  let backup: Client;
  try {
    backup = createClient({ url: backupUrl, authToken: backupToken });
  } catch (err) {
    const id = await logServerError(err, "/api/admin/backup", {
      phase: "connect_backup",
    });
    return NextResponse.json(
      { error: "failed to connect to backup DB", error_id: id },
      { status: 500 },
    );
  }

  try {
    await ensureSchema();
  } catch (err) {
    // Не критично для бэкапа: даже если ensureSchema упал, всё равно
    // попробуем выкачать те таблицы, что уже есть.
    await logServerError(err, "/api/admin/backup", { phase: "ensure_schema" });
  }
  const source = getDb();

  const summary: Array<Record<string, unknown>> = [];
  for (const name of CRITICAL_TABLES) {
    try {
      const r = await backupTable(source, backup, name);
      summary.push({ table: name, ...r });
    } catch (err) {
      const id = await logServerError(err, "/api/admin/backup", { table: name });
      summary.push({ table: name, status: "error", error_id: id });
    }
  }

  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    backup_url: redactUrl(backupUrl),
    tables: summary,
  });
}

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const adminToken = process.env.ADMIN_TOKEN;

  const auth = req.headers.get("authorization");
  const bearer = auth && auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : null;

  if (cronSecret && bearer && bearer === cronSecret) return true;
  if (adminToken) {
    if (bearer && bearer === adminToken) return true;
    const xToken = req.headers.get("x-admin-token");
    if (xToken && xToken === adminToken) return true;
    const url = new URL(req.url);
    const qToken = url.searchParams.get("token");
    if (qToken && qToken === adminToken) return true;
  }
  return false;
}

interface TableBackupResult {
  status: "ok" | "skipped" | "error";
  reason?: string;
  src_rows?: number;
  dst_rows?: number;
  copied?: number;
}

async function backupTable(
  source: Client,
  backup: Client,
  table: string,
): Promise<TableBackupResult> {
  // 1) Есть ли таблица в источнике?
  const exists = await source.execute({
    sql: `SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`,
    args: [table],
  });
  if (exists.rows.length === 0) {
    return { status: "skipped", reason: "missing in source" };
  }
  const ddl = String(exists.rows[0]?.sql ?? "");
  if (!ddl) return { status: "skipped", reason: "no DDL" };

  // 2) Гарантируем таблицу в бэкапе с той же схемой.
  // CREATE TABLE ... -> CREATE TABLE IF NOT EXISTS ...
  const ddlIdempotent = ddl.replace(
    /^\s*CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i,
    "CREATE TABLE IF NOT EXISTS ",
  );
  await backup.execute(ddlIdempotent);

  // 3) Считаем количество строк до решения.
  const tn = quoteIdent(table);
  const srcCount = await source.execute(`SELECT COUNT(*) AS n FROM ${tn}`);
  const srcRows = Number(srcCount.rows[0]?.n ?? 0);
  const dstCount = await backup.execute(`SELECT COUNT(*) AS n FROM ${tn}`);
  const dstRows = Number(dstCount.rows[0]?.n ?? 0);

  // Sanity: источник пуст, а в бэкапе данные → отказываемся затирать.
  if (srcRows === 0 && dstRows > 0) {
    return {
      status: "skipped",
      reason: "source empty but backup has data — refusing to overwrite",
      src_rows: srcRows,
      dst_rows: dstRows,
    };
  }

  if (srcRows === 0) {
    return { status: "ok", src_rows: 0, dst_rows: 0, copied: 0 };
  }

  // 4) Полный snapshot: DELETE + INSERT'ы одной batch-транзакцией.
  const data = await source.execute(`SELECT * FROM ${tn}`);
  const columns = data.columns ?? [];
  if (columns.length === 0) {
    return { status: "skipped", reason: "no columns metadata", src_rows: srcRows };
  }
  const colList = columns.map(quoteIdent).join(", ");
  const placeholders = columns.map(() => "?").join(", ");

  const stmts: InStatement[] = [
    { sql: `DELETE FROM ${tn}`, args: [] },
  ];
  for (const row of data.rows) {
    const args: InValue[] = columns.map((c) => {
      const v = (row as unknown as Record<string, unknown>)[c];
      return (v === undefined ? null : v) as InValue;
    });
    stmts.push({
      sql: `INSERT INTO ${tn} (${colList}) VALUES (${placeholders})`,
      args,
    });
  }

  await backup.batch(stmts, "write");

  return { status: "ok", src_rows: srcRows, copied: data.rows.length };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.pathname}`;
  } catch {
    return "(invalid url)";
  }
}
