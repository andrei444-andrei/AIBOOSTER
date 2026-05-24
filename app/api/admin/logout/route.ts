// Логаут — снимаем cookie и редиректим на главную.

import { NextResponse } from "next/server";
import { ADMIN_AUTH_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const dest = new URL("/", url.origin);
  const res = NextResponse.redirect(dest, { status: 303 });
  res.cookies.set({
    name: ADMIN_AUTH_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export const GET = handle;
export const POST = handle;
