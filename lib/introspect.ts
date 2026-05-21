import { getDb, ensureSchema } from "./db";
import { TABLES } from "./schema";

export interface LiveColumn {
  name: string;
  type: string;
  notNull: boolean;
  pk: boolean;
  description: string; // из реестра схемы, на русском
}

export interface LiveTable {
  name: string;
  description: string; // из реестра схемы
  rowCount: number;
  columns: LiveColumn[];
  knownInRegistry: boolean;
}

// Возвращает реальную структуру БД, слитую с описаниями из реестра (schema.ts).
// Показывает и таблицы, которых нет в реестре (knownInRegistry=false), чтобы
// рассинхрон был сразу виден.
export async function introspect(): Promise<LiveTable[]> {
  await ensureSchema();
  const db = getDb();

  const tablesRes = await db.execute(
    `SELECT name FROM sqlite_master
     WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%'
     ORDER BY name`,
  );
  const liveNames = tablesRes.rows.map((r) => String(r.name));

  const registry = new Map(TABLES.map((t) => [t.name, t]));
  const out: LiveTable[] = [];

  for (const name of liveNames) {
    const reg = registry.get(name);
    const colsRes = await db.execute(`PRAGMA table_info(${quoteIdent(name)})`);
    const regCols = new Map((reg?.columns ?? []).map((c) => [c.name, c.description]));

    const columns: LiveColumn[] = colsRes.rows.map((c) => ({
      name: String(c.name),
      type: String(c.type ?? ""),
      notNull: Number(c.notnull) === 1,
      pk: Number(c.pk) === 1,
      description: regCols.get(String(c.name)) ?? "—",
    }));

    let rowCount = 0;
    try {
      const cntRes = await db.execute(`SELECT COUNT(*) AS n FROM ${quoteIdent(name)}`);
      rowCount = Number(cntRes.rows[0]?.n ?? 0);
    } catch {
      rowCount = -1;
    }

    out.push({
      name,
      description: reg?.description ?? "(нет в реестре schema.ts — описание отсутствует)",
      rowCount,
      columns,
      knownInRegistry: Boolean(reg),
    });
  }

  return out;
}

export interface TablePage {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

// Постраничный read-only просмотр строк таблицы. Имя таблицы валидируется
// против реального списка таблиц, чтобы не было SQL-инъекции через имя.
export async function readTablePage(
  table: string,
  page: number,
  pageSize: number,
): Promise<TablePage> {
  await ensureSchema();
  const db = getDb();

  const tablesRes = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
    args: [table],
  });
  if (tablesRes.rows.length === 0) {
    throw new Error(`unknown table: ${table}`);
  }

  const safePageSize = Math.min(Math.max(pageSize, 1), 200);
  const safePage = Math.max(page, 1);
  const offset = (safePage - 1) * safePageSize;

  const totalRes = await db.execute(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`);
  const total = Number(totalRes.rows[0]?.n ?? 0);

  const dataRes = await db.execute({
    sql: `SELECT * FROM ${quoteIdent(table)} ORDER BY rowid DESC LIMIT ? OFFSET ?`,
    args: [safePageSize, offset],
  });

  return {
    columns: dataRes.columns ?? [],
    rows: dataRes.rows as unknown as Record<string, unknown>[],
    total,
    page: safePage,
    pageSize: safePageSize,
  };
}

// Экранирование идентификатора таблицы/колонки для подстановки в SQL.
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
