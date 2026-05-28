// GET/PUT /api/playlist/config
//
// Хранит ID публичного YouTube-плейлиста — пользователь задаёт его прямо
// на странице /tools/youtube-translate, без env-переменных. Cron-поллер и
// кнопка «обновить» читают значение из БД (с фолбэком на env-переменную
// YOUTUBE_PLAYLIST_ID, если в БД ещё пусто).
//
// Без auth: фича персональная, секретов нет — playlist_id и так публичный
// (его видно в URL плейлиста). Запись не имеет блокирующих последствий —
// в худшем случае подменят на чужой плейлист, переведём чужие видео.

import { NextResponse } from "next/server";
import { getPlaylistId, setPlaylistId } from "@/lib/playlist";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const playlistId = await getPlaylistId();
    return NextResponse.json({
      playlist_id: playlistId,
      configured: !!playlistId,
    });
  } catch (err) {
    const error_id = await logServerError(err, "/api/playlist/config GET");
    return NextResponse.json(
      { error: "не удалось прочитать настройку", error_id },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  let body: { playlist_id?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const raw = body.playlist_id;
  if (raw !== null && typeof raw !== "string") {
    return NextResponse.json(
      { error: "playlist_id должен быть строкой или null" },
      { status: 400 },
    );
  }

  // Принимаем не только голый ID, но и полный URL — выгребем ID сами.
  const playlistId = raw === null ? null : extractPlaylistId(raw);
  try {
    await setPlaylistId(playlistId);
    return NextResponse.json({ ok: true, playlist_id: playlistId });
  } catch (err) {
    const error_id = await logServerError(err, "/api/playlist/config PUT");
    return NextResponse.json(
      { error: "не удалось сохранить настройку", error_id },
      { status: 500 },
    );
  }
}

// «PLxyz...» отдаём как есть, «https://youtube.com/playlist?list=PLxyz...»
// разбираем — пользователь скопировал URL целиком, это нормально.
function extractPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const fromList = u.searchParams.get("list");
      if (fromList) return fromList;
    } catch {
      // невалидный URL — упадём в return ниже
    }
  }
  return trimmed;
}
