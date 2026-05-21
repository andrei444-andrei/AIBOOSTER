// Защита служебных эндпоинтов токеном. Никогда не публичны (CONSTITUTION §4).
//
// Токен принимается одним из способов (для удобства агентов/curl):
//   - заголовок  Authorization: Bearer <token>
//   - заголовок  x-admin-token: <token>
//   - query      ?token=<token>
//
// Сравнение — в постоянном времени. Если ADMIN_TOKEN не задан в окружении,
// доступ закрыт полностью (fail-closed), а не открыт.

import { timingSafeEqual } from "node:crypto";

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

function extractToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  const headerToken = req.headers.get("x-admin-token");
  if (headerToken) return headerToken.trim();

  const url = new URL(req.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken.trim();

  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
