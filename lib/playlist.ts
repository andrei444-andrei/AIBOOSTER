// YouTube-плейлист → автоочередь переводов.
//
// Тянем публичный плейлист через RSS-фид YouTube (бесплатно, без API-ключа):
//   https://www.youtube.com/feeds/videos.xml?playlist_id=<PLAYLIST_ID>
//
// Из фида берём videoId, проверяем по БД — нет ли уже job'а на эту пару
// (videoId, DEFAULT_TARGET_LANG). Новые — создаём со source='playlist'.
//
// Используется в /api/cron/poll-playlist (раз в минуту) и в
// /api/playlist/refresh (кнопка «обновить» в UI).

import { ensureSchema, getDb } from "./db";
import { createJob, hasJobForVideo } from "./jobs";
import { fetchYoutubeTitle } from "./youtube";

const DEFAULT_TARGET_LANG = "ru";
const DEFAULT_QUALITY = "best";

// Источник правды для playlist_id: сначала БД (video_translate_settings —
// пользователь задаёт прямо на странице), потом env (YOUTUBE_PLAYLIST_ID —
// бэкап для случая если БД ещё пуста). Возвращает null если нигде не задан.
export async function getPlaylistId(): Promise<string | null> {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute(
    `SELECT playlist_id FROM video_translate_settings WHERE id = 1`,
  );
  const fromDb = (res.rows[0] as unknown as { playlist_id: string | null } | undefined)
    ?.playlist_id;
  if (fromDb) return fromDb;
  const fromEnv = process.env.YOUTUBE_PLAYLIST_ID;
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : null;
}

export async function setPlaylistId(playlistId: string | null): Promise<void> {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const value = playlistId && playlistId.trim() ? playlistId.trim() : null;
  // UPSERT через INSERT ON CONFLICT — таблица single-row (id=1).
  await db.execute({
    sql: `INSERT INTO video_translate_settings (id, playlist_id, created_at, updated_at)
          VALUES (1, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET playlist_id = excluded.playlist_id, updated_at = excluded.updated_at`,
    args: [value, now, now],
  });
}

// Парсим videoId + title из RSS-фида плейлиста. Атом-формат YouTube кладёт
// каждое видео в <entry>, внутри есть <yt:videoId> и <title>. Без XML-
// парсера: фид плоский, regex по entry-блокам справляется надёжно.
function extractEntries(xml: string): Array<{ videoId: string; title: string | null }> {
  const out: Array<{ videoId: string; title: string | null }> = [];
  const seen = new Set<string>();
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/g) ?? [];
  for (const entry of entries) {
    const idMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    if (!idMatch) continue;
    const videoId = idMatch[1].trim();
    if (!videoId || seen.has(videoId)) continue;
    const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
    const title = titleMatch ? decodeXmlText(titleMatch[1].trim()) : null;
    out.push({ videoId, title });
    seen.add(videoId);
  }
  return out;
}

// Минимальный decoder XML-entities — RSS приходит без CDATA, но с &amp;
// &quot; &lt; &gt; в названиях. Полную либу тащить не нужно.
function decodeXmlText(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

export interface PollResult {
  playlistId: string;
  totalInFeed: number;
  alreadyHave: number;
  queued: Array<{ videoId: string; jobId: string }>;
  skipped: Array<{ videoId: string; reason: string }>;
}

export async function pollPlaylist(): Promise<PollResult> {
  const playlistId = await getPlaylistId();
  if (!playlistId) {
    throw new Error(
      "Плейлист не задан — открой /tools/youtube-translate и впиши ID " +
        "публичного плейлиста (часть URL после list=) в поле сверху.",
    );
  }

  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;
  const res = await fetch(feedUrl, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; AIBoosterPlaylistPoller/1.0; +https://aibooster.dev)",
    },
    // Cache не нужен — мы и так зовём не чаще раза в минуту.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `RSS feed playlist ${playlistId} ответил ${res.status}: ${(
        await res.text().catch(() => "")
      ).slice(0, 200)}`,
    );
  }
  const xml = await res.text();
  const entries = extractEntries(xml);

  const result: PollResult = {
    playlistId,
    totalInFeed: entries.length,
    alreadyHave: 0,
    queued: [],
    skipped: [],
  };

  for (const entry of entries) {
    const exists = await hasJobForVideo(entry.videoId, DEFAULT_TARGET_LANG);
    if (exists) {
      result.alreadyHave++;
      continue;
    }
    try {
      // RSS уже дал название — используем его. Если по какой-то причине
      // пусто (старый видео-формат, кириллица в кодировке), фолбэчимся
      // на oEmbed. Если и oEmbed не дал — пайплайн всё равно подтянет
      // через Apify позже (updateJobProgress({ title })).
      const title = entry.title || (await fetchYoutubeTitle(entry.videoId));
      const job = await createJob({
        videoId: entry.videoId,
        targetLang: DEFAULT_TARGET_LANG,
        quality: DEFAULT_QUALITY,
        source: "playlist",
        title,
      });
      result.queued.push({ videoId: entry.videoId, jobId: job.id });
    } catch (err) {
      result.skipped.push({
        videoId: entry.videoId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
