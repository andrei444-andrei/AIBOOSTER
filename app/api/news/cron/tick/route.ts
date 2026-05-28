import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { logServerError } from "@/lib/logger";
import { runTick } from "@/lib/news-pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// На Vercel Pro: даём функции до 60s. Telegram-фетч в async-режиме, валидация
// батчем по 10, в большинстве tick'ов укладываемся в 10-20s.
export const maxDuration = 60;

// POST/GET /api/news/cron/tick
// Триггер Vercel Cron каждые 10 минут. Защищён CRON_SECRET (Vercel шлёт его
// заголовком `Authorization: Bearer ${CRON_SECRET}`).
//
// Возвращает JSON-статистику: что засеяно, какой источник обработан, сколько
// постов добавлено и провалидировано. Это нужно, чтобы можно было curl'ом
// проверить, что cron живой, и видеть burn-rate Apify/aimlapi.
async function handle(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!constantTimeEqual(token, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // CRON_SECRET и ADMIN_TOKEN должны отличаться — иначе leaks одного открывает
  // оба. Мягкая проверка: warn в логи, но не отказ.
  if (process.env.ADMIN_TOKEN && process.env.ADMIN_TOKEN === expected) {
    await logServerError(
      new Error("CRON_SECRET == ADMIN_TOKEN — use distinct values"),
      "news/cron/tick",
    );
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

export async function POST(req: Request) {
  return handle(req);
}

// Vercel Cron делает GET — поддерживаем оба метода.
export async function GET(req: Request) {
  return handle(req);
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
