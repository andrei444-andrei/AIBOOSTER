// POST /api/playlist/refresh
//
// Кнопка «обновить» в библиотеке — пользователь не хочет ждать минуту до
// следующего cron-тика, дёргает поллер вручную.
//
// Без auth: фича персональная, плейлист публичный, ничего ценного не
// раскрывает. Если кто-то снаружи начнёт спамить — это просто заставит
// нас лишний раз сходить за RSS и сделать N noop'ов в БД (всё уже в очереди).

import { NextResponse } from "next/server";
import { pollPlaylist } from "@/lib/playlist";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  if (!process.env.YOUTUBE_PLAYLIST_ID) {
    return NextResponse.json(
      {
        error:
          "YOUTUBE_PLAYLIST_ID не задан в env Vercel — нечего опрашивать",
      },
      { status: 400 },
    );
  }
  try {
    const result = await pollPlaylist();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const error_id = await logServerError(err, "/api/playlist/refresh");
    return NextResponse.json({ error: "poll failed", error_id }, { status: 500 });
  }
}
