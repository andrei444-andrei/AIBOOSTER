"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import styles from "./Toast.module.css";

type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  title: ReactNode;
  message?: ReactNode;
  duration?: number;
}

interface ToastEntry extends ToastOptions {
  id: string;
  kind: ToastKind;
  leaving: boolean;
}

interface ToastApi {
  show: (kind: ToastKind, opts: ToastOptions) => string;
  info: (opts: ToastOptions) => string;
  success: (opts: ToastOptions) => string;
  warning: (opts: ToastOptions) => string;
  error: (opts: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeNow = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      setTimeout(() => removeNow(id), 140);
    },
    [removeNow]
  );

  const show = useCallback(
    (kind: ToastKind, opts: ToastOptions) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const duration = opts.duration ?? 4000;
      setToasts((prev) => [...prev, { ...opts, id, kind, leaving: false }]);
      if (duration > 0) {
        const t = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, t);
      }
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      info: (o) => show("info", o),
      success: (o) => show("success", o),
      warning: (o) => show("warning", o),
      error: (o) => show("error", o),
      dismiss,
    }),
    [show, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.container} aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={[styles.toast, styles[t.kind], t.leaving ? styles.leaving : ""].join(" ")}
            role={t.kind === "error" || t.kind === "warning" ? "alert" : "status"}
          >
            <span className={styles.bar} aria-hidden />
            <div className={styles.content}>
              <div className={styles.title}>{t.title}</div>
              {t.message ? <div className={styles.message}>{t.message}</div> : null}
            </div>
            <button
              type="button"
              className={styles.close}
              onClick={() => dismiss(t.id)}
              aria-label="Закрыть уведомление"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within <ToastProvider>");
  }
  return ctx;
}
