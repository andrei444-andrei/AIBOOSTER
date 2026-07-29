// Защита служебных эндпоинтов токеном. Никогда не публичны (CONSTITUTION §4).
//
// Токен принимается одним из способов (приоритет сверху вниз):
//   - httpOnly cookie  aibooster_admin  (выставляется /api/admin/login, живёт год)
//   - заголовок  Authorization: Bearer <token>
//   - заголовок  x-admin-token: <token>
//   - query      ?token=<token>
//
// Cookie — для людей: ввёл токен один раз на /admin → ходишь всюду без &token=.
// Header/query — для curl и серверных интеграций, без которых отлаживаться неудобно.
//
// Сравнение — в постоянном времени. Если ADMIN_TOKEN не задан в окружении,
// доступ закрыт полностью (fail-closed), а не открыт.

import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_AUTH_COOKIE = "aibooster_admin";
// Год — стандартный «remember me» горизонт; кука httpOnly + secure, утечь
// через JS нельзя, а перевыпустить можно через /admin/logout или ротацию ADMIN_TOKEN.
export const ADMIN_AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type AuthResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

export function checkAdminToken(req: Request): AuthResult {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return {
      ok: false,
      status: 503,
      reason: "ADMIN_TOKEN is not configured on the server",
    };
  }

  const provided = extractToken(req);
  if (!provided) {
    return { ok: false, status: 401, reason: "missing admin token" };
  }

  if (!constantTimeEqual(provided, expected)) {
    return { ok: false, status: 403, reason: "invalid admin token" };
  }

  return { ok: true };
}

// Проверка токена по значению — для серверных страниц (/admin), где нет Request.
export function checkAdminTokenValue(provided: string | null | undefined): AuthResult {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return { ok: false, status: 503, reason: "ADMIN_TOKEN is not configured on the server" };
  }
  if (!provided) {
    return { ok: false, status: 401, reason: "missing admin token" };
  }
  if (!constantTimeEqual(provided, expected)) {
    return { ok: false, status: 403, reason: "invalid admin token" };
  }
  return { ok: true };
}

// Достаёт токен из cookies — для server components, где Request недоступен.
// Возвращает строку (даже невалидный токен), валидация — отдельно.
export async function readAdminCookieToken(): Promise<string | null> {
  try {
    const c = await cookies();
    return c.get(ADMIN_AUTH_COOKIE)?.value ?? null;
  } catch {
    // cookies() недоступны вне server-context — не падаем.
    return null;
  }
}

// Удобный helper для серверных страниц: проверяем cookie сначала, потом
// fallback на ?token=... (для прямых ссылок с токеном в URL — старая совместимость).
// Возвращает успешную аутентификацию + токен, который нужно положить в cookie
// (если ещё не положен) — для миграции старых URL'ов на cookie.
export async function resolveAdminAuth(queryToken: string | null | undefined): Promise<{
  auth: AuthResult;
  token: string | null;
  fromCookie: boolean;
}> {
  const cookieToken = await readAdminCookieToken();
  if (cookieToken) {
    const a = checkAdminTokenValue(cookieToken);
    if (a.ok) return { auth: a, token: cookieToken, fromCookie: true };
    // Cookie битый/просрочился (ротация ADMIN_TOKEN) — игнорируем, пробуем query.
  }
  const a = checkAdminTokenValue(queryToken);
  return { auth: a, token: a.ok ? (queryToken ?? null) : null, fromCookie: false };
}

function extractToken(req: Request): string | null {
  // 1. Cookie — основной канал для UI.
  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) {
    const v = parseCookie(cookieHeader, ADMIN_AUTH_COOKIE);
    if (v) return v;
  }

  // 2. Bearer header — для curl/SDK.
  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  // 3. x-admin-token — историческое; для редиректов с external services.
  const headerToken = req.headers.get("x-admin-token");
  if (headerToken) return headerToken.trim();

  // 4. ?token=... — последняя соломинка, чтобы не сломать старые ссылки.
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken.trim();

  return null;
}

function parseCookie(header: string, name: string): string | null {
  // Простой парсер cookie-header. На сервере мы выставляем только одно имя,
  // нет смысла тащить полный набор Set-Cookie attribute'ов.
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
