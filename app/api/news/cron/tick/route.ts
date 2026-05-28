import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { checkAdminToken } from "@/lib/auth";
import { logServerError } from "@/lib/logger";
import { runTick } from "@/lib/news-pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// На Vercel Pro: даём функции до 60s. Telegram-фетч в async-режиме, валидация
// батчем по 10, в большинстве tick'ов укладываемся в 10-20s.
export const maxDuration = 60;

// POST/GET /api/news/cron/tick
//
// Триггер Vercel Cron каждые 10 минут.
//
// Авторизация — повторяет проектную конвенцию (см. app/api/adapters/tick):
//   1) Если CRON_SECRET задан в env — Vercel шлёт Bearer с ним, принимаем.
//   2) Ручной вызов с ADMIN_TOKEN — тоже принимаем (для curl/MCP-debug).
//   3) Если CRON_SECRET НЕ задан — endpoint открыт. Vercel cron шлёт без
//      auth-header'ов, и мы его пропускаем. Это намеренно: single-user
//      проект, никаких данных наружу не отдаётся, внешний вызов в худшем
//      случае стоит нам лишних функция-минут (как и любой другой cron).
async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const workerId = `cron-${Date.now()}`;
  try {
    const stats = await runTick(workerId);
    return NextResponse.json({ ok: true, ts: new Date().toISOString(), stats });
  } catch (err) {
    const error_id = await logServerError(err, "news/cron/tick");
    return NextResponse.json(
      { ok: false, error: "tick failed", error_id },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") || "";
    const provided = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    if (provided && constantTimeEqual(provided, cronSecret)) return true;
    // Bearer не подошёл — идём ниже, дадим шанс ADMIN_TOKEN.
  }
  const adminCheck = checkAdminToken(req);
  if (adminCheck.ok) return true;
  // CRON_SECRET НЕ задан → пропускаем без auth (Vercel cron-конвенция проекта).
  return !cronSecret;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
