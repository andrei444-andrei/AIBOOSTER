"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "./AppShell";

/** Решает, оборачивать ли страницу в общий AppShell.
 *  /chat имеет свой собственный layout (с secondaryPanel — историей чатов),
 *  поэтому оборачивается внутри ChatApp напрямую. Остальное — стандартный шелл. */
export function AppShellGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";

  // /chat сам управляет шеллом (нужна история сессий как secondaryPanel)
  if (pathname.startsWith("/chat")) return <>{children}</>;

  return <AppShell>{children}</AppShell>;
}
