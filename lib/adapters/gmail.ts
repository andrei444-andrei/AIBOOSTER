// Gmail adapter — инкрементальный pull через users.history.list.
//
// Поток sync():
//   1) Refresh access_token, если нужно (refresh_token хранится в creds).
//   2) Если есть cursor.history_id → history.list(startHistoryId) → получаем
//      id новых/изменённых сообщений.
//   3) Если cursor пуст или history_id протух (404 от Google) → fallback
//      на messages.list?q=newer_than:7d, забираем последние ~100 писем.
//   4) Для каждого нового id → messages.get(format=full) → parse → upsert
//      в gmail_messages + upsertSnippet в context_snippets.
//   5) Запоминаем новый history_id в cursor.
//
// Тайм-бюджет учитывается в runner.ts (он передаёт shouldStop()), здесь же
// мы просто прерываемся между сообщениями, если время вышло.

import { getDb, ensureSchema } from "../db";
import { upsertSnippet } from "./context";
import type { Adapter, SyncArgs, SyncResult } from "./types";

export interface GmailCreds {
  // Один из вариантов:
  // (1) refresh_token + client_id/secret из env GOOGLE_OAUTH_* — рекомендую.
  // (2) Свежий access_token напрямую (короткоживущий, для отладки).
  refresh_token?: string;
  access_token?: string;
  access_token_expires_at?: string; // ISO; если истёк — рефрешим
  client_id?: string;
  client_secret?: string;
}

export interface GmailCursor {
  history_id?: string;
}

const API = "https://gmail.googleapis.com/gmail/v1";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";

// Сколько сообщений тянем за один sync — баланс между свежестью и таймаутом.
const MAX_MESSAGES_PER_SYNC = 50;

// Если cursor пуст / протух, забираем письма за последние N дней.
const COLD_START_RANGE = "newer_than:7d";

export const GmailAdapter: Adapter<GmailCreds, GmailCursor> = {
  kind: "gmail",
  defaultIntervalSec: 120,

  async sync(args: SyncArgs<GmailCreds, GmailCursor>): Promise<SyncResult<GmailCursor>> {
    const accessToken = await ensureAccessToken(args.creds);
    const startHistoryId = args.cursor?.history_id;

    // Шаг 1: получаем список id'ов писем для обработки.
    let messageIds: string[] = [];
    let nextHistoryId: string | undefined;

    if (startHistoryId) {
      try {
        const hist = await fetchHistory(accessToken, startHistoryId);
        messageIds = hist.messageIds;
        nextHistoryId = hist.lastHistoryId;
      } catch (err) {
        // 404 = history_id протух (старше ~7 дней). Делаем cold-start.
        if (isNotFound(err)) {
          const cold = await fetchColdStartIds(accessToken);
          messageIds = cold.messageIds;
          nextHistoryId = cold.profileHistoryId;
        } else {
          throw err;
        }
      }
    } else {
      const cold = await fetchColdStartIds(accessToken);
      messageIds = cold.messageIds;
      nextHistoryId = cold.profileHistoryId;
    }

    // Шаг 2: для каждого id — fetch + upsert. Ограничены MAX_MESSAGES_PER_SYNC,
    // остальное подберём следующим запуском (history_id мы не двигаем дальше
    // фактически обработанных сообщений).
    const toProcess = messageIds.slice(0, MAX_MESSAGES_PER_SYNC);
    let fetched = 0;
    let lastProcessedHistoryId: string | undefined;

    for (const id of toProcess) {
      const msg = await fetchMessage(accessToken, id);
      const parsed = parseMessage(msg);
      await saveMessage({
        sourceId: args.sourceId,
        id: parsed.id,
        threadId: parsed.threadId,
        historyId: parsed.historyId,
        internalDate: parsed.internalDate,
        fromAddr: parsed.from,
        toAddrs: parsed.to,
        cc: parsed.cc,
        subject: parsed.subject,
        snippet: parsed.snippet,
        bodyText: parsed.bodyText,
        labels: parsed.labels,
        hasAttachments: parsed.hasAttachments,
        raw: msg,
      });
      await upsertSnippet({
        source: "gmail",
        sourceRef: parsed.id,
        ts: parsed.internalDate ?? new Date().toISOString(),
        title: parsed.subject,
        body: buildSnippetBody(parsed),
        meta: {
          from: parsed.from,
          to: parsed.to,
          thread_id: parsed.threadId,
          labels: parsed.labels,
          url: `https://mail.google.com/mail/u/0/#inbox/${parsed.id}`,
        },
      });
      fetched++;
      args.onProgress?.(Math.round((fetched / Math.max(1, toProcess.length)) * 100));
      if (parsed.historyId) lastProcessedHistoryId = parsed.historyId;
    }

    // Если cold-start выгребли неполностью (из-за лимита) — следующий sync
    // снова пойдёт через cold-start: дублей не будет (UNIQUE по id), но и
    // history_id не зацементируется до тех пор, пока хвост не выберется.
    // Поэтому правильнее всё-таки двинуть cursor вперёд только когда мы
    // обработали ВСЕ сообщения партии.
    const finalCursor: GmailCursor = {
      history_id:
        toProcess.length === messageIds.length
          ? nextHistoryId
          : lastProcessedHistoryId ?? args.cursor?.history_id,
    };

    return {
      newCursor: finalCursor,
      fetched,
      stats: {
        considered: messageIds.length,
        processed: toProcess.length,
        cold_start: !startHistoryId,
      },
    };
  },
};

// --- HTTP к Gmail/OAuth -----------------------------------------------------

async function ensureAccessToken(creds: GmailCreds): Promise<string> {
  // Если есть валидный access_token — используем как есть.
  if (creds.access_token && creds.access_token_expires_at) {
    const exp = Date.parse(creds.access_token_expires_at);
    if (Number.isFinite(exp) && exp - Date.now() > 60_000) {
      return creds.access_token;
    }
  }
  if (creds.access_token && !creds.refresh_token) {
    // Нет рефреша — отдаём что есть, может ещё жив.
    return creds.access_token;
  }
  if (!creds.refresh_token) {
    throw new Error("gmail creds missing both access_token and refresh_token");
  }

  const client_id = creds.client_id ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
  const client_secret = creds.client_secret ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!client_id || !client_secret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / SECRET not configured");
  }

  const body = new URLSearchParams({
    client_id,
    client_secret,
    refresh_token: creds.refresh_token,
    grant_type: "refresh_token",
  });
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`google token refresh failed: ${res.status} ${txt.slice(0, 200)}`);
  }
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  return j.access_token;
}

async function fetchHistory(
  accessToken: string,
  startHistoryId: string,
): Promise<{ messageIds: string[]; lastHistoryId?: string }> {
  // history.list возвращает события добавления/изменения; нам нужны ids
  // добавленных в INBOX. Поддерживаем пагинацию (1 запрос обычно достаточен).
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let lastHistoryId: string | undefined;
  for (let i = 0; i < 5; i++) {
    const url = new URL(`${API}/users/me/history`);
    url.searchParams.set("startHistoryId", startHistoryId);
    url.searchParams.set("historyTypes", "messageAdded");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 404) {
      const err = new Error("history_id is stale (404)");
      (err as Error & { status?: number }).status = 404;
      throw err;
    }
    if (!res.ok) {
      throw new Error(`gmail history.list failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const j = (await res.json()) as {
      history?: Array<{ messages?: Array<{ id: string }> }>;
      historyId?: string;
      nextPageToken?: string;
    };
    for (const h of j.history ?? []) {
      for (const m of h.messages ?? []) ids.add(m.id);
    }
    if (j.historyId) lastHistoryId = j.historyId;
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return { messageIds: Array.from(ids), lastHistoryId };
}

async function fetchColdStartIds(
  accessToken: string,
): Promise<{ messageIds: string[]; profileHistoryId?: string }> {
  // Узнаём текущий historyId аккаунта — будет нашим cursor'ом после cold-start.
  const profRes = await fetch(`${API}/users/me/profile`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!profRes.ok) {
    throw new Error(`gmail profile failed: ${profRes.status} ${(await profRes.text()).slice(0, 200)}`);
  }
  const prof = (await profRes.json()) as { historyId?: string };

  // Берём последние ~100 писем из inbox за неделю.
  const url = new URL(`${API}/users/me/messages`);
  url.searchParams.set("q", COLD_START_RANGE);
  url.searchParams.set("maxResults", "100");
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`gmail messages.list failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const j = (await res.json()) as { messages?: Array<{ id: string }> };
  return {
    messageIds: (j.messages ?? []).map((m) => m.id),
    profileHistoryId: prof.historyId,
  };
}

async function fetchMessage(accessToken: string, id: string): Promise<GmailMessageRaw> {
  const url = new URL(`${API}/users/me/messages/${encodeURIComponent(id)}`);
  url.searchParams.set("format", "full");
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`gmail messages.get(${id}) failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as GmailMessageRaw;
}

function isNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    ((err as Error & { status?: number }).status === 404 ||
      /\b404\b/.test(err.message))
  );
}

// --- Парсинг сообщения Gmail ------------------------------------------------

interface GmailMessageRaw {
  id: string;
  threadId?: string;
  historyId?: string;
  internalDate?: string; // ms as string
  snippet?: string;
  labelIds?: string[];
  payload?: GmailPart;
}
interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

interface ParsedMessage {
  id: string;
  threadId: string | null;
  historyId: string | null;
  internalDate: string | null;
  from: string | null;
  to: string | null;
  cc: string | null;
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  labels: string[];
  hasAttachments: boolean;
}

function parseMessage(m: GmailMessageRaw): ParsedMessage {
  const headers = m.payload?.headers ?? [];
  const h = (name: string) =>
    headers.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? null;

  const internalDate = m.internalDate
    ? new Date(Number(m.internalDate)).toISOString()
    : null;

  const bodyText = extractText(m.payload);
  const hasAttachments = hasAttachmentParts(m.payload);

  return {
    id: m.id,
    threadId: m.threadId ?? null,
    historyId: m.historyId ?? null,
    internalDate,
    from: h("From"),
    to: h("To"),
    cc: h("Cc"),
    subject: h("Subject"),
    snippet: m.snippet ?? null,
    bodyText,
    labels: m.labelIds ?? [],
    hasAttachments,
  };
}

function extractText(part: GmailPart | undefined): string | null {
  if (!part) return null;
  // Предпочитаем text/plain, если есть в любой части дерева.
  const plain = findFirst(part, (p) => p.mimeType === "text/plain" && !!p.body?.data);
  if (plain?.body?.data) return decodeBase64Url(plain.body.data);
  const html = findFirst(part, (p) => p.mimeType === "text/html" && !!p.body?.data);
  if (html?.body?.data) return stripHtml(decodeBase64Url(html.body.data));
  return null;
}

function findFirst(part: GmailPart, pred: (p: GmailPart) => boolean): GmailPart | null {
  if (pred(part)) return part;
  for (const c of part.parts ?? []) {
    const found = findFirst(c, pred);
    if (found) return found;
  }
  return null;
}

function hasAttachmentParts(part: GmailPart | undefined): boolean {
  if (!part) return false;
  if (part.filename && part.filename.length > 0) return true;
  for (const c of part.parts ?? []) {
    if (hasAttachmentParts(c)) return true;
  }
  return false;
}

function decodeBase64Url(s: string): string {
  // Gmail возвращает body как base64url (с -, _ и без паддинга).
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  try {
    return Buffer.from(b64 + pad, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function stripHtml(html: string): string {
  // Минималистичная очистка: убираем script/style + теги. Для агента этого
  // обычно достаточно; если потребуется качественный HTML→text, добавим
  // зависимость позже.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Тело для context_snippets — заголовки + body, ограниченное по длине.
function buildSnippetBody(p: ParsedMessage): string {
  const parts: string[] = [];
  if (p.from) parts.push(`From: ${p.from}`);
  if (p.to) parts.push(`To: ${p.to}`);
  if (p.subject) parts.push(`Subject: ${p.subject}`);
  parts.push("");
  if (p.bodyText) {
    // Ограничиваем размером ~8k символов — хватает для агента, не раздувает БД.
    parts.push(p.bodyText.slice(0, 8000));
  } else if (p.snippet) {
    parts.push(p.snippet);
  }
  return parts.join("\n");
}

// --- Запись в gmail_messages ------------------------------------------------

async function saveMessage(args: {
  sourceId: string;
  id: string;
  threadId: string | null;
  historyId: string | null;
  internalDate: string | null;
  fromAddr: string | null;
  toAddrs: string | null;
  cc: string | null;
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  labels: string[];
  hasAttachments: boolean;
  raw: unknown;
}): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO gmail_messages
            (id, source_id, thread_id, history_id, internal_date,
             from_addr, to_addrs, cc, subject, snippet, body_text,
             labels, has_attachments, raw, fetched_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            source_id = excluded.source_id,
            thread_id = excluded.thread_id,
            history_id = excluded.history_id,
            internal_date = excluded.internal_date,
            from_addr = excluded.from_addr,
            to_addrs = excluded.to_addrs,
            cc = excluded.cc,
            subject = excluded.subject,
            snippet = excluded.snippet,
            body_text = excluded.body_text,
            labels = excluded.labels,
            has_attachments = excluded.has_attachments,
            raw = excluded.raw`,
    args: [
      args.id,
      args.sourceId,
      args.threadId,
      args.historyId,
      args.internalDate,
      args.fromAddr,
      args.toAddrs,
      args.cc,
      args.subject,
      args.snippet,
      args.bodyText,
      JSON.stringify(args.labels),
      args.hasAttachments ? 1 : 0,
      JSON.stringify(args.raw),
      now,
    ],
  });
}
