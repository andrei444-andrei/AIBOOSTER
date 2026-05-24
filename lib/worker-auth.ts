import { timingSafeEqual } from "node:crypto";

export type AuthResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

export function checkWorkerSecret(req: Request): AuthResult {
  const expected = process.env.WORKER_SECRET;
  if (!expected) {
    return {
      ok: false,
      status: 503,
      reason: "WORKER_SECRET is not configured on the server",
    };
  }

  const provided =
    req.headers.get("x-worker-secret") ??
    req.headers.get("authorization")?.replace(/^bearer /i, "") ??
    new URL(req.url).searchParams.get("secret") ??
    null;

  if (!provided) {
    return { ok: false, status: 401, reason: "missing worker secret" };
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 403, reason: "invalid worker secret" };
  }

  return { ok: true };
}
