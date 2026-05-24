import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ToastProvider } from "@/components/ui";
import { AppShellGate } from "@/components/shell/AppShellGate";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIBOOSTER",
  description: "Ускоренное решение задач с помощью AI в несколько шагов.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <ToastProvider>
          <AppShellGate>{children}</AppShellGate>
        </ToastProvider>
      </body>
    </html>
  );
}
