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

// Парсим videoId'ы из RSS-фида. Атом-формат YouTube кладёт ID в тег
// <yt:videoId>...</yt:videoId>. Не тянем библиотеку XML-парсера — фид
// плоский, regex надёжно справляется.
function extractVideoIds(xml: string): string[] {
  const ids: string[] = [];
  const re = /<yt:videoId>([^<]+)<\/yt:videoId>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const id = m[1].trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
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
  const videoIds = extractVideoIds(xml);

  const result: PollResult = {
    playlistId,
    totalInFeed: videoIds.length,
    alreadyHave: 0,
    queued: [],
    skipped: [],
  };

  for (const videoId of videoIds) {
    const exists = await hasJobForVideo(videoId, DEFAULT_TARGET_LANG);
    if (exists) {
      result.alreadyHave++;
      continue;
    }
    try {
      const job = await createJob({
        videoId,
        targetLang: DEFAULT_TARGET_LANG,
        quality: DEFAULT_QUALITY,
        source: "playlist",
      });
      result.queued.push({ videoId, jobId: job.id });
    } catch (err) {
      result.skipped.push({
        videoId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
