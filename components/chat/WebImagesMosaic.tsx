"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./WebImagesMosaic.module.css";

export interface WebImageItem {
  /** URL картинки. */
  src: string;
  /** Заголовок страницы-источника (опционально). */
  title?: string;
  /** URL страницы-источника (опционально, для кнопки «Источник →» в лайтбоксе). */
  origin?: string;
}

interface Props {
  images: WebImageItem[];
}

const MAX_VISIBLE = 4;

/** Адаптивная мозаика веб-картинок + встроенный лайтбокс.
 *  N=1: одна по центру. N=2: 50/50. N=3-4: hero+stack. N≥5: hero+stack
 *  с overlay «+N» на последней миниатюре. */
export function WebImagesMosaic({ images }: Props) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  if (!images || images.length === 0) return null;

  const n = Math.min(images.length, MAX_VISIBLE);
  const visible = images.slice(0, MAX_VISIBLE);
  const extra = images.length - MAX_VISIBLE;

  return (
    <>
      <div className={styles.mosaic} data-n={n}>
        {visible.map((img, i) => {
          const isLast = i === MAX_VISIBLE - 1 && extra > 0;
          // Клик по overlay-«+N» открывает лайтбокс с 5-й картинки,
          // клик по обычной миниатюре — с этой картинки.
          const openAt = isLast ? MAX_VISIBLE : i;
          return (
            <button
              key={i}
              type="button"
              className={styles.cell}
              onClick={() => setLightboxIdx(openAt)}
              aria-label={img.title ?? `Картинка ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.src}
                alt={img.title ?? ""}
                loading="lazy"
                referrerPolicy="no-referrer"
                draggable={false}
              />
              {isLast && (
                <div className={styles.moreOverlay}>
                  <span>+{extra + 1}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {lightboxIdx !== null && (
        <Lightbox
          images={images}
          startIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </>
  );
}

// ─── Lightbox ──────────────────────────────────────────────────────

function Lightbox({
  images,
  startIndex,
  onClose,
}: {
  images: WebImageItem[];
  startIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);
  const safeIdx = Math.max(0, Math.min(idx, images.length - 1));
  const current = images[safeIdx];

  const goPrev = useCallback(() => {
    setIdx((i) => (i - 1 + images.length) % images.length);
  }, [images.length]);
  const goNext = useCallback(() => {
    setIdx((i) => (i + 1) % images.length);
  }, [images.length]);

  // Esc / arrow keys + блокировка скролла body пока открыто.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, goPrev, goNext]);

  if (!current) return null;

  const domain = current.origin ? safeDomain(current.origin) : null;

  return (
    <div
      className={styles.lightboxBackdrop}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр изображения"
    >
      <button
        type="button"
        className={`${styles.lbBtn} ${styles.lbClose}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Закрыть"
        title="Закрыть (Esc)"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>

      {images.length > 1 && (
        <button
          type="button"
          className={`${styles.lbBtn} ${styles.lbPrev}`}
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          aria-label="Предыдущая"
          title="Предыдущая (←)"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      )}

      <div className={styles.lbStage} onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.src}
          alt={current.title ?? ""}
          className={styles.lbImage}
          referrerPolicy="no-referrer"
          draggable={false}
        />
        <div className={styles.lbCaption}>
          <div className={styles.lbCaptionText}>
            {current.title && <div className={styles.lbTitle}>{current.title}</div>}
            {domain && <div className={styles.lbDomain}>{domain}</div>}
          </div>
          <div className={styles.lbActions}>
            {images.length > 1 && (
              <span className={styles.lbCounter}>{safeIdx + 1} / {images.length}</span>
            )}
            {current.origin && (
              <a
                href={current.origin}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.lbSourceBtn}
              >
                Источник
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M7 17 17 7" />
                  <path d="M7 7h10v10" />
                </svg>
              </a>
            )}
          </div>
        </div>
      </div>

      {images.length > 1 && (
        <button
          type="button"
          className={`${styles.lbBtn} ${styles.lbNext}`}
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          aria-label="Следующая"
          title="Следующая (→)"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      )}
    </div>
  );
}

function safeDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
