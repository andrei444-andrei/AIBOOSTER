// POST /api/jobs/backfill-titles
//
// Одноразовая ручка: для всех job'ов с пустым yt_title тянем название
// через YouTube oEmbed и проставляем. До деплоя этой версии новые job'ы
// создавались без title (Apify-актор его не возвращал), и в библиотеке
// показывался только video_id вместо нормального названия.
//
// Без auth (id job'а публичен, секретов не раскрывает, а само oEmbed
// возвращает только то, что и так публично).

import { NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db";
import { fetchYoutubeTitle } from "@/lib/youtube";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    await ensureSchema();
    const db = getDb();
    const res = await db.execute(
      `SELECT id, yt_video_id FROM video_translation_jobs
       WHERE yt_title IS NULL OR yt_title = ''
       ORDER BY created_at DESC
       LIMIT 50`,
    );
    const rows = res.rows as unknown as Array<{ id: string; yt_video_id: string }>;
    const updated: string[] = [];
    for (const row of rows) {
      const title = await fetchYoutubeTitle(row.yt_video_id);
      if (!title) continue;
      await db.execute({
        sql: `UPDATE video_translation_jobs SET yt_title = ?, updated_at = ? WHERE id = ?`,
        args: [title, new Date().toISOString(), row.id],
      });
      updated.push(row.yt_video_id);
    }
    return NextResponse.json({ ok: true, scanned: rows.length, updated });
  } catch (err) {
    const error_id = await logServerError(err, "/api/jobs/backfill-titles");
    return NextResponse.json({ error: "backfill failed", error_id }, { status: 500 });
  }
}
