// Vercel Cron: каждую минуту смотрит публичный YouTube-плейлист
// (YOUTUBE_PLAYLIST_ID) и ставит в очередь перевода те видео, для которых
// ещё нет job'а. Перевод запускает следующий тик /api/cron/process-jobs.
//
// Auth: Bearer CRON_SECRET || ADMIN_TOKEN — как и у соседнего process-jobs.

import { NextResponse } from "next/server";
import { getPlaylistId, pollPlaylist } from "@/lib/playlist";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET || process.env.ADMIN_TOKEN || "";
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Плейлист не задан — это не ошибка, а «фича выключена». Не шумим
  // в app_errors каждую минуту.
  const playlistId = await getPlaylistId();
  if (!playlistId) {
    return NextResponse.json({ ok: true, disabled: true });
  }
  try {
    const result = await pollPlaylist();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const error_id = await logServerError(err, "/api/cron/poll-playlist");
    return NextResponse.json({ error: "poll failed", error_id }, { status: 500 });
  }
}
