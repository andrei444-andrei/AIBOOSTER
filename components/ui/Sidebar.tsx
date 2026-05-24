"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getPinnedModules, isModuleActive, type ModuleEntry } from "@/lib/modules";
import styles from "./Sidebar.module.css";

export function Sidebar() {
  const pathname = usePathname() || "/";
  const pinned = getPinnedModules();
  const main = pinned.filter((m) => m.section === "main");
  const service = pinned.filter((m) => m.section === "service");

  return (
    <aside className={styles.sidebar} aria-label="Навигация">
      <Link href="/" className={styles.brand}>
        <span className={styles.brandLogo} aria-hidden>
          A
        </span>
        AIBOOSTER
      </Link>

      <div className={styles.section}>
        {main.map((m) => (
          <Item key={m.slug} m={m} active={isModuleActive(m, pathname)} />
        ))}
      </div>

      {service.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Служебные</div>
          <div className={styles.section}>
            {service.map((m) => (
              <Item key={m.slug} m={m} active={isModuleActive(m, pathname)} />
            ))}
          </div>
        </>
      )}

      <div className={styles.spacer} />
    </aside>
  );
}

function Item({ m, active }: { m: ModuleEntry; active: boolean }) {
  return (
    <Link
      href={m.href}
      className={[styles.item, active ? styles.active : ""].filter(Boolean).join(" ")}
      aria-current={active ? "page" : undefined}
      title={m.description}
    >
      {m.icon ? <span className={styles.itemIcon} aria-hidden>{m.icon}</span> : null}
      <span className={styles.itemTitle}>{m.title}</span>
      {m.requiresAdminToken ? <span className={styles.lockHint}>token</span> : null}
    </Link>
  );
}
