"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import styles from "./Sidebar.module.css";

/**
 * Shell приложения: на десктопе — sidebar слева + контент. На мобилке —
 * фиксированный топ-бар с гамбургером, sidebar открывается drawer'ом
 * поверх контента с подложкой.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Закрываем drawer на смене страницы. Без этого после клика по ссылке в
  // меню он остался бы открытым, перекрывая новый контент.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Блокируем скролл body когда drawer открыт — иначе можно скроллить
  // фоновый контент пальцем через подложку, неприятно ощущается.
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  return (
    <div className={styles.layout}>
      {/* Top-bar — только мобилка, скрыт media-query'ем на десктопе */}
      <header className={styles.mobileBar}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Открыть меню"
          className={styles.menuButton}
        >
          <span className={styles.menuIcon} aria-hidden>
            <span />
            <span />
            <span />
          </span>
        </button>
        <Link href="/" className={styles.mobileBrand}>
          <span className={styles.brandLogo} aria-hidden>
            A
          </span>
          AIBOOSTER
        </Link>
      </header>

      {open && (
        <button
          type="button"
          className={styles.backdrop}
          onClick={() => setOpen(false)}
          aria-label="Закрыть меню"
        />
      )}

      <Sidebar mobileOpen={open} />

      <div className={styles.main}>{children}</div>
    </div>
  );
}
