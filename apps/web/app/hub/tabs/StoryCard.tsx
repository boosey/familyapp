"use client";

/**
 * StoryCard — the photo-forward story card rendered in the Hub feed (Feed mode), extracted from the
 * former inline `FeedCard` in StoryBrowse.tsx so the Playful structural signatures (tilt, tape,
 * sticker tags, highlighter, feature hero) can hook the hashed CSS-module classes. Faithful port of
 * the prior FeedCard: same data wiring (cover + non-cover thumbnails via the audited
 * /api/album-photo/[photoId] byte route, `isNew` badge, content + family tags), same two layouts
 * (`masonry` = stacked vertical card, column = wide horizontal card).
 *
 * All styling lives in StoryCard.module.css (token-driven). Signatures are skin-scoped via `:global`
 * and suppressed under reduce-motion / solemn. See apps/web/app/_skins/CSS-MODULES.md.
 */
import type { CSSProperties } from "react";
import Link from "next/link";
import { hub, common } from "@/app/_copy";
import type { StoryItem } from "./story-browse-types";
import { initials } from "./story-browse-helpers";
import styles from "./StoryCard.module.css";

export function StoryCard({
  item,
  href,
  index,
  masonry = false,
  variant = "feed",
}: {
  item: StoryItem;
  /** Pre-built detail href from the caller (`${item.href}?from=${mode}`) — do NOT rebuild here. */
  href: string;
  /** Position in the feed — drives the odd/even tilt via the `--tilt` custom property. */
  index: number;
  /** Masonry (stacked vertical) vs. column (wide horizontal) layout. */
  masonry?: boolean;
  /** The wider hero used for the first cover-bearing item in the masonry feed. */
  variant?: "feed" | "feature";
}) {
  // The non-cover accompaniment photos: everything in the ordered photo set except the cover (which
  // already shows big). Filtering by id — not by position — is robust even if the cover isn't the
  // first element, and yields [] for a text-only or cover-only story.
  const nonCoverPhotoIds = item.photoIds.filter((id) => id !== item.coverPhotoId);

  const className = [
    styles.card,
    masonry ? styles.masonry : styles.column,
    variant === "feature" ? styles.feature : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link
      href={href}
      className={className}
      style={{ "--tilt": index % 2 ? "-0.55deg" : "0.55deg" } as CSSProperties}
    >
      {item.isNew ? (
        <span className={styles.newBadge}>
          <span className={styles.newDot} aria-hidden="true" />
          {common.storyCard.badgeNew}
        </span>
      ) : null}

      {/* Cover accompaniment (ADR-0009): the story's cover photo, served by the audited byte route.
          A story with no attached image renders NOTHING here — a text-only card is first-class, so
          there is no placeholder. In masonry the cover sits on top full-width (natural aspect, so
          card heights vary); in column it's a fixed square on the left. */}
      {item.coverPhotoId ? (
        <span className={styles.photoWrap}>
          {/* eslint-disable-next-line @next/next/no-img-element -- bytes are served by our audited auth
              route (/api/album-photo/[photoId]), not a static asset; next/image would proxy/optimize it. */}
          <img src={`/api/album-photo/${item.coverPhotoId}`} alt="" className={styles.cover} loading="lazy" />
        </span>
      ) : null}

      <div className={styles.body}>
        <div className={styles.metaRow}>
          <span className={styles.initialsCircle} aria-hidden="true">
            {initials(item.personName)}
          </span>
          <span className={styles.personName}>{item.personName}</span>
          <span className={styles.metaDot} aria-hidden="true" />
          <span className={styles.eventLabel}>{item.eventLabel ?? hub.browse.undated}</span>
        </div>

        <p className={styles.title}>{item.title}</p>
        {item.summary ? <p className={styles.summary}>{item.summary}</p> : null}

        <div className={styles.tags}>
          {item.tags.map((tag, i) => (
            <span key={`${tag}-${i}`} className={[styles.sticker, styles[`sticker${i % 4}` as const]].join(" ")}>
              {tag}
            </span>
          ))}
          {item.families.map((f) => (
            <span key={f.id} className={styles.familyTag}>
              {f.shortName || f.name}
            </span>
          ))}
        </div>

        {/* Non-cover accompaniment photos — a small thumbnail row below the tags (ADR-0009). The cover
            already shows big; these are the story's other attached photos, each served by the audited
            /api/album-photo/[photoId] byte route. Nothing renders for a cover-only story. */}
        {nonCoverPhotoIds.length > 0 ? (
          <div className={styles.thumbRow}>
            {nonCoverPhotoIds.map((pid) => (
              // eslint-disable-next-line @next/next/no-img-element -- audited auth byte route, not a static asset
              <img
                key={pid}
                src={`/api/album-photo/${pid}`}
                alt=""
                data-testid="card-photo-thumb"
                className={styles.thumb}
                loading="lazy"
              />
            ))}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
