// Логин в админку: POST формы с token → выставляем httpOnly cookie → редирект.
//
// Один цикл «ввёл секрет, и забыл про него» — на год. Cookie httpOnly+secure,
// XSS до неё не дотянется, а JS-снифферы конфигурации не увидят. Если потребуется
// разлогинить — /api/admin/logout. Если потребуется выкинуть всех — ротируем
// переменную ADMIN_TOKEN на Vercel (старые cookie перестанут валидироваться).

import { NextResponse } from "next/server";
import {
  ADMIN_AUTH_COOKIE,
  ADMIN_AUTH_COOKIE_MAX_AGE,
  checkAdminTokenValue,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let token: string | null = null;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const v = form.get("token");
    if (typeof v === "string") token = v.trim();
  } else if (ct.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { token?: string } | null;
    if (body && typeof body.token === "string") token = body.token.trim();
  }

  const auth = checkAdminTokenValue(token);
  // Куда отправить после успеха — параметр ?next=..., по умолчанию /admin.
  // Не пускаем абсолютные URL'ы, чтобы не было open-redirect.
  const url = new URL(req.url);
  const nextRaw = url.searchParams.get("next");
  const next = nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/admin";

  if (!auth.ok) {
    // Возвращаем на админку с явной ошибкой в query, чтобы пользователь видел
    // что именно не так (форма перечитает auth и снова покажет себя с reason'ом).
    const back = new URL(next, url.origin);
    back.searchParams.set("login_error", auth.reason);
    return NextResponse.redirect(back, { status: 303 });
  }

  const dest = new URL(next, url.origin);
  const res = NextResponse.redirect(dest, { status: 303 });
  res.cookies.set({
    name: ADMIN_AUTH_COOKIE,
    value: token!,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_AUTH_COOKIE_MAX_AGE,
  });
  return res;
}
