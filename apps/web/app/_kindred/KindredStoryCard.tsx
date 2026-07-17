import type { HTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { common } from "@/app/_copy";

export interface KindredStoryCardProps
  extends Omit<HTMLAttributes<HTMLElement>, "title" | "onClick"> {
  title?: string;
  year?: string;
  place?: string;
  duration?: string;
  excerpt?: string;
  imageSrc?: string;
  pinned?: boolean;
  recordedLabel?: string;
  isNew?: boolean;
  era?: string;
  byline?: string;
  meta?: string[];
  href?: string;
  onClick?: () => void;
  showArrow?: boolean;
  children?: ReactNode;
}

/**
 * Album-leaf story row — hard border, photo lead, no float/shadow chrome.
 */
export function KindredStoryCard({
  title,
  year,
  place,
  duration,
  excerpt,
  imageSrc,
  pinned = false,
  recordedLabel,
  isNew = false,
  era,
  byline,
  meta = [],
  href,
  onClick,
  showArrow = true,
  style,
  children,
  ...rest
}: KindredStoryCardProps) {
  const Tag: "a" | "div" = href ? "a" : "div";
  const interactive = Boolean(href ?? onClick);

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

  const newMetaParts = [byline, year, place, duration].filter(Boolean) as string[];
  const hasNewMeta = newMetaParts.length > 0;

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
      className={interactive ? "spark-card-lift" : undefined}
      style={{
        display: "flex",
        gap: "var(--space-5)",
        alignItems: "stretch",
        background: "var(--surface-card)",
        border: "var(--border-width, 2px) solid var(--border-strong)",
        borderRadius: "var(--radius-md)",
        padding: 0,
        boxShadow: "none",
        cursor: interactive ? "pointer" : "default",
        color: "inherit",
        textDecoration: "none",
        position: "relative",
        overflow: "hidden",
        ...style,
      }}
    >
      {imageSrc ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={imageSrc}
          alt=""
          style={{
            width: 132,
            minHeight: 132,
            alignSelf: "stretch",
            flexShrink: 0,
            borderRadius: 0,
            objectFit: "cover",
            borderRight: "var(--border-width) solid var(--border-strong)",
          }}
        />
      ) : (
        <div
          aria-hidden="true"
          style={{
            width: 132,
            minHeight: 132,
            flexShrink: 0,
            background: "var(--accent-soft)",
            borderRight: "var(--border-width) solid var(--border-strong)",
            display: "flex",
            alignItems: "flex-end",
            padding: 12,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-label)",
              color: "var(--accent-strong)",
              letterSpacing: "var(--tracking-mono)",
              textTransform: "uppercase",
            }}
          >
            {common.storyCard.photo}
          </span>
        </div>
      )}

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "16px 8px 16px 0",
        }}
      >
        {metaLabel || recordedLabel || isNew ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: "var(--space-2)",
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minWidth: 0,
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-label)",
                color: "var(--text-meta)",
                letterSpacing: "var(--tracking-mono)",
              }}
            >
              {isNew ? <NewPill /> : null}
              {metaLabel ? (
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {metaLabel}
                </span>
              ) : null}
            </span>
            {recordedLabel ? (
              <span
                title={common.storyCard.recordedTitle(recordedLabel)}
                style={{
                  flex: "0 0 auto",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-label)",
                  color: "var(--text-muted)",
                  letterSpacing: "var(--tracking-mono)",
                }}
              >
                {recordedLabel}
              </span>
            ) : null}
          </div>
        ) : null}

        {title ? (
          <div
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-story-lg)",
              lineHeight: "var(--leading-snug)",
              fontWeight: 500,
              color: "var(--text-body)",
              marginBottom: "var(--space-2)",
              letterSpacing: "var(--tracking-tight)",
            }}
          >
            {title}
          </div>
        ) : null}

        {excerpt ? (
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-muted)",
              lineHeight: "var(--leading-body)",
              margin: 0,
              marginBottom: children ? "var(--space-2)" : 0,
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

      {interactive && showArrow ? (
        <span
          aria-hidden="true"
          style={{
            alignSelf: "center",
            padding: "0 18px",
            color: "var(--accent)",
            fontSize: 28,
            fontWeight: 400,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          →
        </span>
      ) : null}

      {pinned ? (
        <span
          aria-label={common.storyCard.pinned}
          style={{
            position: "absolute",
            top: 10,
            right: interactive && showArrow ? 48 : 12,
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

function NewPill() {
  return (
    <span
      style={{
        flex: "0 0 auto",
        padding: "2px 7px",
        borderRadius: "var(--radius-sm)",
        background: "var(--accent)",
        color: "var(--accent-on)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-label)",
        letterSpacing: "var(--tracking-mono)",
        lineHeight: 1.4,
        textTransform: "uppercase",
        fontWeight: 700,
      }}
    >
      {common.storyCard.badgeNew}
    </span>
  );
}
