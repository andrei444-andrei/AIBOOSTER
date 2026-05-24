"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./Markdown.module.css";

export interface MarkdownProps {
  source: string;
}

export function Markdown({ source }: MarkdownProps) {
  return (
    <div className={styles.md}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // ReactMarkdown по умолчанию НЕ рендерит raw HTML (отлично — безопасно).
        // Все теги ниже — обёртки для предсказуемой стилизации.
        components={{
          a: ({ href, children, ...rest }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow" {...rest}>
              {children}
            </a>
          ),
          // оборачиваем таблицу — на узком экране нужен горизонтальный скролл
          table: ({ children, ...rest }) => (
            <div className={styles.tableWrap}>
              <table {...rest}>{children}</table>
            </div>
          ),
          img: ({ src, alt, ...rest }) => {
            // только http(s) и data:image
            if (typeof src !== "string") return null;
            if (!/^(https?:\/\/|data:image\/)/i.test(src)) return <span>[image: {alt ?? src}]</span>;
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={src} alt={alt ?? ""} loading="lazy" {...rest} />;
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
