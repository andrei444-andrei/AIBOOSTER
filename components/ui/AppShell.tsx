import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import styles from "./Sidebar.module.css";

/**
 * Стандартный shell приложения: Sidebar слева + основной контент справа.
 * Подключается один раз в app/layout.tsx и оборачивает все страницы.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.layout}>
      <Sidebar />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
