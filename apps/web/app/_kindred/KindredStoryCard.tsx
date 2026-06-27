import type { HTMLAttributes, KeyboardEvent, ReactNode } from "react";

export interface KindredStoryCardProps
  extends Omit<HTMLAttributes<HTMLElement>, "title" | "onClick"> {
  /* New hi-fi fields */
  title?: string;
  year?: string;
  place?: string;
  duration?: string;
  excerpt?: string;
  imageSrc?: string;
  pinned?: boolean;
  /* Legacy back-compat fields (hub page still passes these) */
  era?: string;
  byline?: string;
  meta?: string[];
  /* Behaviour */
  href?: string;
  onClick?: () => void;
  children?: ReactNode;
}

/**
 * A single story card — 120 × 120 photo thumbnail (or striped placeholder),
 * mono metadata row, serif title, excerpt, and optional pin indicator.
 *
 * Legacy: if `year`/`place`/`duration` are absent the component falls back to
 * the old `era` + `meta[]` display so the current hub page keeps working.
 */
export function KindredStoryCard({
  title,
  year,
  place,
  duration,
  excerpt,
  imageSrc,
  pinned = false,
  era,
  byline,
  meta = [],
  href,
  onClick,
  style,
  children,
  ...rest
}: KindredStoryCardProps) {
  const Tag: "a" | "div" = href ? "a" : "div";
  const interactive = Boolean(href ?? onClick);

  /* For onClick-only (non-anchor) cards, make the <div> keyboard accessible. */
  const buttonProps =
    !href && onClick
      ? {
          role: "button",
          tabIndex: 0,
          onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
            if (e.key === "Enter" || e.key === " ") {
              if (e.key === " ") e.preventDefault();
              onClick();
            }
          },
        }
      : {};

  /* Build the metadata row content. Prefer new scalar fields; fall back to legacy. */
  const newMetaParts = [year, place, duration].filter(Boolean) as string[];
  const hasNewMeta = newMetaParts.length > 0;

  /* Legacy row: era + byline + meta[] bullets */
  const legacyMetaParts: string[] = [];
  if (era) legacyMetaParts.push(era);
  if (byline) legacyMetaParts.push(byline);
  legacyMetaParts.push(...meta);

  const metaLabel = hasNewMeta
    ? newMetaParts.join(" · ")
    : legacyMetaParts.join(" · ") || null;

  return (
    <Tag
      {...rest}
      {...(href ? { href } : {})}
      {...buttonProps}
      onClick={onClick}
      style={{
        display: "flex",
        gap: "var(--space-5)",
        alignItems: "center",
        background: "var(--surface-card)",
        border: "var(--border-width, 1.5px) solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-5)",
        boxShadow: "var(--shadow-card)",
        cursor: interactive ? "pointer" : "default",
        color: "inherit",
        textDecoration: "none",
        position: "relative",
        ...style,
      }}
    >
      {/* Thumbnail / placeholder */}
      {imageSrc ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={imageSrc}
          alt=""
          style={{
            width: 120,
            height: 120,
            flexShrink: 0,
            borderRadius: "var(--radius-md)",
            objectFit: "cover",
          }}
        />
      ) : (
        <div
          aria-hidden="true"
          style={{
            width: 120,
            height: 120,
            flexShrink: 0,
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--surface-sunken)",
            backgroundImage:
              "repeating-linear-gradient(45deg, var(--surface-sunken) 0 10px, var(--surface-page) 10px 20px)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            paddingBottom: 8,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-label)",
              color: "var(--text-muted)",
            }}
          >
            photo
          </span>
        </div>
      )}

      {/* Content column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Mono metadata row */}
        {metaLabel ? (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-label)",
              color: "var(--text-meta)",
              letterSpacing: "var(--tracking-mono)",
              marginBottom: "var(--space-2)",
            }}
          >
            {metaLabel}
          </div>
        ) : null}

        {/* Serif title */}
        {title ? (
          <div
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-story-lg)",
              lineHeight: "var(--leading-snug)",
              color: "var(--text-body)",
              marginBottom: "var(--space-2)",
            }}
          >
            {title}
          </div>
        ) : null}

        {/* Excerpt */}
        {excerpt ? (
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-muted)",
              lineHeight: "var(--leading-body)",
              margin: 0,
              marginBottom: children ? "var(--space-2)" : 0,
              /* Clamp to 3 lines */
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {excerpt}
          </p>
        ) : null}

        {children}
      </div>

      {/* Arrow — only when interactive */}
      {interactive ? (
        <span
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            border: "1.5px solid var(--border-strong)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--accent)",
            fontSize: 22,
            flexShrink: 0,
          }}
        >
          {"›"}
        </span>
      ) : null}

      {/* Pin indicator */}
      {pinned ? (
        <span
          aria-label="Pinned"
          style={{
            position: "absolute",
            top: "var(--space-3)",
            right: interactive ? 68 : "var(--space-4)",
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          📌
        </span>
      ) : null}
    </Tag>
  );
}
