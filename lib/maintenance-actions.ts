// Whitelisted action handlers для maintenance-агента. Каждое действие —
// ограниченное по scope'у и аудируемое. Любой action возвращает
// { ok, message } / { ok: false, message } — никаких throw наружу.

import { ensureSchema, getDb } from "./db";
import {
  resetEnrichmentToPending,
  getSource,
  setSourceActive,
  updateSourceUrl,
  setItemArchived,
  getItem,
  type SourceKind,
} from "./news";
import { discoverFeed } from "./feed-discover";
import { countSuccessfulRetries, wasActionAppliedRecently } from "./maintenance-db";

const MAX_RETRIES_PER_ITEM = 3;

export interface ActionResult {
  result: "ok" | "skipped" | "error";
  message: string;
}

export async function retryEnrichmentAction(itemId: string, reason: string): Promise<ActionResult> {
  void reason;
  const item = await getItem(itemId);
  if (!item) return { result: "error", message: `item ${itemId} not found` };

  const tried = await countSuccessfulRetries(itemId);
  if (tried >= MAX_RETRIES_PER_ITEM) {
    return { result: "skipped", message: `already retried ${tried}× (>= ${MAX_RETRIES_PER_ITEM} cap)` };
  }

  const query = item.title || item.body?.slice(0, 200) || "";
  if (!query.trim()) {
    return { result: "error", message: "empty title/body — cannot enqueue" };
  }

  await resetEnrichmentToPending(itemId, query);
  // Бамп retry_count.
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE news_enrichments SET retry_count = COALESCE(retry_count, 0) + 1 WHERE item_id = ?`,
    args: [itemId],
  });
  return { result: "ok", message: `re-queued (attempt ${tried + 1}/${MAX_RETRIES_PER_ITEM})` };
}

export async function deactivateSourceAction(sourceId: string, reason: string): Promise<ActionResult> {
  void reason;
  const src = await getSource(sourceId);
  if (!src) return { result: "error", message: `source ${sourceId} not found` };
  if (src.active === 0) {
    return { result: "skipped", message: "already inactive" };
  }
  // Anti-loop: уже деактивировали в последние 24ч (а кто-то включил обратно)?
  if (await wasActionAppliedRecently("deactivate_source", sourceId, 24)) {
    return { result: "skipped", message: "anti-loop: deactivated < 24h ago" };
  }
  await setSourceActive(sourceId, false);
  return { result: "ok", message: `«${src.name}» disabled` };
}

export async function rediscoverSourceAction(sourceId: string, reason: string): Promise<ActionResult> {
  void reason;
  const src = await getSource(sourceId);
  if (!src) return { result: "error", message: `source ${sourceId} not found` };
  if (await wasActionAppliedRecently("rediscover_source", sourceId, 24)) {
    return { result: "skipped", message: "anti-loop: rediscovered < 24h ago" };
  }
  // Берём root domain текущего URL'а и пробуем discoverFeed с него.
  let homeUrl = src.url;
  try {
    const u = new URL(src.url);
    homeUrl = `${u.protocol}//${u.host}`;
  } catch {
    return { result: "error", message: "invalid existing URL, cannot determine homepage" };
  }
  let kindNew: SourceKind | undefined;
  let urlNew: string;
  try {
    const d = await discoverFeed(homeUrl);
    kindNew = d.kind;
    urlNew = d.feed_url;
  } catch (err) {
    return {
      result: "error",
      message: `discoverFeed failed: ${err instanceof Error ? err.message.slice(0, 100) : "?"}`,
    };
  }
  if (urlNew === src.url && (kindNew === src.kind || !kindNew)) {
    return { result: "skipped", message: "discover returned same URL — нечего менять" };
  }
  await updateSourceUrl(sourceId, urlNew, kindNew);
  return {
    result: "ok",
    message: `URL обновлён: ${src.url.slice(0, 80)} → ${urlNew.slice(0, 80)} (${kindNew})`,
  };
}

export async function archiveItemAction(itemId: string, reason: string): Promise<ActionResult> {
  void reason;
  const item = await getItem(itemId);
  if (!item) return { result: "error", message: `item ${itemId} not found` };
  await setItemArchived(itemId, true);
  return { result: "ok", message: `item archived: ${(item.title ?? "").slice(0, 60)}` };
}

export async function noteFindingAction(text: string): Promise<ActionResult> {
  // Просто записывается через recordMaintenanceAction (вызывающий код).
  return { result: "ok", message: text.slice(0, 200) };
}
