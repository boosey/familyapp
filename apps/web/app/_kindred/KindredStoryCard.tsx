import type { HTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { common } from "@/app/_copy";

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
  /** Short recorded-date stamp shown in the card's top-right corner, e.g. "JUN 2026". */
  recordedLabel?: string;
  /** Renders a "NEW" pill at the start of the meta row (story unseen by the viewer). */
  isNew?: boolean;
  /* Legacy back-compat fields (hub page still passes these) */
  era?: string;
  byline?: string;
  meta?: string[];
  /* Behaviour */
  href?: string;
  onClick?: () => void;
  showArrow?: boolean;
  children?: ReactNode;
}

/**
 * A single story card — media-forward composition with soft lift motion.
 * Photo leads when present; text-only stories keep a vivid accent panel.
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
        border: "var(--border-width, 1.5px) solid var(--border)",
        borderRadius: "var(--radius-xl)",
        padding: "var(--space-4)",
        boxShadow: "var(--shadow-card)",
        cursor: interactive ? "pointer" : "default",
        color: "inherit",
        textDecoration: "none",
        position: "relative",
        overflow: "hidden",
        ...style,
      }}
    >
      {/* Media column */}
      {imageSrc ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={imageSrc}
          alt=""
          style={{
            width: 140,
            minHeight: 140,
            alignSelf: "stretch",
            flexShrink: 0,
            borderRadius: "var(--radius-lg)",
            objectFit: "cover",
          }}
        />
      ) : (
        <div
          aria-hidden="true"
          style={{
            width: 140,
            minHeight: 140,
            flexShrink: 0,
            borderRadius: "var(--radius-lg)",
            background:
              "linear-gradient(145deg, var(--accent-soft) 0%, color-mix(in srgb, var(--support-soft) 80%, var(--accent-soft)) 55%, var(--surface-sunken) 100%)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "flex-start",
            padding: 14,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              position: "absolute",
              inset: "-20% auto auto 40%",
              width: 90,
              height: 90,
              borderRadius: "50%",
              background: "color-mix(in srgb, var(--accent) 18%, transparent)",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "1.05rem",
              fontWeight: 600,
              color: "var(--accent-strong)",
              letterSpacing: "var(--tracking-tight)",
              position: "relative",
            }}
          >
            {common.storyCard.photo}
          </span>
        </div>
      )}

      {/* Content column */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "4px 4px 4px 0",
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
              fontWeight: 550,
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
          style={{
            width: 48,
            height: 48,
            alignSelf: "center",
            borderRadius: "var(--radius-md)",
            border: "1.5px solid var(--border-strong)",
            background: "var(--accent-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--accent-strong)",
            fontSize: 22,
            flexShrink: 0,
            fontWeight: 600,
          }}
        >
          {"›"}
        </span>
      ) : null}

      {pinned ? (
        <span
          aria-label={common.storyCard.pinned}
          style={{
            position: "absolute",
            top: "var(--space-3)",
            right: interactive && showArrow ? 68 : "var(--space-4)",
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
        padding: "3px 9px",
        borderRadius: "var(--radius-sm)",
        background: "linear-gradient(120deg, var(--accent), var(--support))",
        color: "#fff",
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
