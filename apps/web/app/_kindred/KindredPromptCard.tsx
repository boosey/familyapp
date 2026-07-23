import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import styles from "./KindredPromptCard.module.css";

export interface KindredPromptCardProps extends HTMLAttributes<HTMLDivElement> {
  eyebrow?: string;
  /** Accepts a string or any renderable node; serialized-string callers and JSX callers both compile. */
  question?: ReactNode;
  children?: ReactNode;
}

/** A family member's question, set in serif — the seed of every conversation. */
export function KindredPromptCard({
  eyebrow,
  question,
  children,
  className,
  style,
  ...rest
}: KindredPromptCardProps) {
  const mergedClass = className ? `${styles.card} ${className}` : styles.card;
  return (
    <div className={mergedClass} style={style as CSSProperties | undefined} {...rest}>
      {eyebrow ? (
        <div className={styles.eyebrow}>
          <span className={styles.dot} aria-hidden="true" />
          {eyebrow}
        </div>
      ) : null}
      {question != null ? <div className={styles.question}>{question}</div> : null}
      {children}
    </div>
  );
}
