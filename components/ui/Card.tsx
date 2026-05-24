import type { HTMLAttributes, ReactNode, ElementType } from "react";
import styles from "./Card.module.css";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  interactive?: boolean;
  padded?: boolean;
  as?: ElementType;
}

export function Card({
  interactive = false,
  padded = true,
  as,
  className,
  children,
  ...rest
}: CardProps) {
  const Tag = (as ?? (interactive ? "button" : "div")) as ElementType;
  const classes = [
    styles.card,
    padded ? styles.padding : "",
    interactive ? styles.interactive : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={[styles.header, className ?? ""].filter(Boolean).join(" ")} {...rest}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)" }}>
        <div>
          {title ? <h3 className={styles.title}>{title}</h3> : null}
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </div>
        {actions ? <div>{actions}</div> : null}
      </div>
    </div>
  );
}

export function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={[styles.body, className ?? ""].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={[styles.footer, className ?? ""].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}
