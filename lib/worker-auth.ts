// Защита эндпоинтов /api/worker/* отдельным секретом.
//
// Не используем ADMIN_TOKEN: у воркера и админа разные роли и разный риск
// компрометации. Если воркеру утечёт токен — он не должен открывать /admin.
//
// Заголовок: Authorization: Bearer <WORKER_SECRET>

import { timingSafeEqual } from "node:crypto";

export type WorkerAuthResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

export function checkWorkerSecret(req: Request): WorkerAuthResult {
  const expected = process.env.WORKER_SECRET;
  if (!expected) {
    return { ok: false, status: 503, reason: "WORKER_SECRET is not configured on the server" };
  }
  const auth = req.headers.get("authorization");
  const provided =
    auth && auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  if (!provided) {
    return { ok: false, status: 401, reason: "missing worker secret" };
  }
  if (!constantTimeEqual(provided, expected)) {
    return { ok: false, status: 403, reason: "invalid worker secret" };
  }
  return { ok: true };
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
