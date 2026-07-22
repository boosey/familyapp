"use client";

/**
 * StoryCard — the story card rendered in the Hub feed (Feed mode), extracted from the former inline
 * `FeedCard` in StoryBrowse.tsx so the Scrapbook structural signatures (tilt, tape, sticker tags,
 * highlighter) can hook the hashed CSS-module classes.
 *
 * In the Scrapbook masonry feed the card is no longer always photo-top: `layout` (assigned
 * deterministically per story by `pickStoryLayout`) selects one of several editorial variants so the
 * feed reads like a scrapbook, never the same tile repeating:
 *   • top      — photo above the body (the classic look; kept in rotation for contrast).
 *   • left     — horizontal card, cover runs down the left ~42%, body on the right.
 *   • wrap     — the cover floats and the prose wraps around it.
 *   • collage  — cover + up to two extra photos in a small grid above the body.
 *   • textonly — no photo; a taped title + stickers (shorter card, breaks the rhythm).
 * Column view is uniform and passes no layout (defaults to `top`).
 *
 * Same data wiring throughout: cover + non-cover thumbnails via the audited /api/album-photo/[photoId]
 * byte route — the downscaled `?variant=thumb` everywhere EXCEPT the masonry `top` cover, which renders
 * as a full-width hero and keeps the original bytes. `isNew` badge, content + family tags. All styling
 * lives in StoryCard.module.css
 * (token-driven). Signatures are skin-scoped via `:global` and suppressed under reduce-motion / solemn.
 * See apps/web/app/_skins/CSS-MODULES.md.
 */
import type { CSSProperties } from "react";
import Link from "next/link";
import { hub, common } from "@/app/_copy";
import type { StoryItem } from "./story-browse-types";
import type { StoryLayout } from "./story-layout";
import { initials } from "./story-browse-helpers";
import { albumPhotoSrc } from "@/app/hub/album/photo-src";
import styles from "./StoryCard.module.css";

export function StoryCard({
  item,
  href,
  index,
  masonry = false,
  layout = "top",
}: {
  item: StoryItem;
  /** Pre-built detail href from the caller (`${item.href}?from=${mode}`) — do NOT rebuild here. */
  href: string;
  /** Position in the feed — drives the odd/even tilt via the `--tilt` custom property. */
  index: number;
  /** Masonry (stacked vertical) vs. column (wide horizontal) layout. */
  masonry?: boolean;
  /**
   * The editorial card layout for the masonry feed (deterministic per story via pickStoryLayout).
   * Defaults to `top`, the classic photo-above-body card, so the column view and any non-masonry
   * caller stay uniform.
   */
  layout?: StoryLayout;
}) {
  // The non-cover accompaniment photos: everything in the ordered photo set except the cover (which
  // already shows big). Filtering by id — not by position — is robust even if the cover isn't the
  // first element, and yields [] for a text-only or cover-only story.
  const nonCoverPhotoIds = item.photoIds.filter((id) => id !== item.coverPhotoId);

  // The effective layout is what pickStoryLayout chose. A missing cover always collapses to text-only
  // regardless of the request.
  const effectiveLayout: StoryLayout = !item.coverPhotoId ? "textonly" : layout;

  const layoutClass =
    effectiveLayout === "left"
      ? styles.layLeft
      : effectiveLayout === "wrap"
        ? styles.layWrap
        : effectiveLayout === "collage"
          ? styles.layCollage
          : effectiveLayout === "textonly"
            ? styles.textonly
            : null;

  const className = [
    styles.card,
    masonry ? styles.masonry : styles.column,
    layoutClass,
  ]
    .filter(Boolean)
    .join(" ");

  // The photos rendered in a collage: cover first, then up to two extra (non-cover) photos.
  const collagePhotoIds =
    item.coverPhotoId != null ? [item.coverPhotoId, ...nonCoverPhotoIds.slice(0, 2)] : [];

  const badge = item.isNew ? (
    <span className={styles.newBadge}>
      <span className={styles.newDot} aria-hidden="true" />
      {common.storyCard.badgeNew}
    </span>
  ) : null;

  const bodyInner = (
    <>
      <div className={styles.metaRow}>
        <span className={styles.initialsCircle} aria-hidden="true">
          {initials(item.personName)}
        </span>
        <span className={styles.personName}>{item.personName}</span>
        <span className={styles.metaDot} aria-hidden="true" />
        <span className={styles.eventLabel}>
          {item.eventLabel ?? hub.browse.undated}
        </span>
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

      {/* Non-cover accompaniment photos — a small thumbnail row below the tags (ADR-0009). Not shown in
          collage (those extra photos already appear in the grid) or wrap/left layouts, where the extra
          thumbnails would fight the floated/side photo. */}
      {effectiveLayout === "top" && nonCoverPhotoIds.length > 0 ? (
        <div className={styles.thumbRow}>
          {nonCoverPhotoIds.map((pid) => (
            // eslint-disable-next-line @next/next/no-img-element -- audited auth byte route, not a static asset
            <img
              key={pid}
              src={albumPhotoSrc(pid, { thumb: true })}
              alt=""
              data-testid="card-photo-thumb"
              className={styles.thumb}
              loading="lazy"
            />
          ))}
        </div>
      ) : null}
    </>
  );

  return (
    <Link
      href={href}
      className={className}
      style={{ "--tilt": index % 2 ? "-0.55deg" : "0.55deg" } as CSSProperties}
    >
      {badge}

      {/* WRAP: the cover floats INSIDE the body so the prose wraps around it (mockup .lay-wrap). */}
      {effectiveLayout === "wrap" && item.coverPhotoId ? (
        <div className={styles.body}>
          {/* eslint-disable-next-line @next/next/no-img-element -- audited auth byte route */}
          <img src={albumPhotoSrc(item.coverPhotoId, { thumb: true })} alt="" className={styles.wrapPhoto} loading="lazy" />
          {bodyInner}
        </div>
      ) : null}

      {/* COLLAGE: cover + up to two extra photos in a small grid above the body (mockup .collage). */}
      {effectiveLayout === "collage" && collagePhotoIds.length > 0 ? (
        <>
          <span className={styles.collage} aria-hidden="true">
            {collagePhotoIds.map((pid, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- audited auth byte route
              <img
                key={pid}
                src={albumPhotoSrc(pid, { thumb: true })}
                alt=""
                data-testid="card-photo-thumb"
                className={[styles.collageCell, i === 0 ? styles.collageTall : null].filter(Boolean).join(" ")}
                loading="lazy"
              />
            ))}
          </span>
          <div className={styles.body}>{bodyInner}</div>
        </>
      ) : null}

      {/* TOP (default) and LEFT: the cover sits outside the body — above it in `top` (full width), or
          down the left side in `left`. Text-only renders no photo at all. The masonry `top` cover is
          the feed's one hero image (full card width, up to 320px tall) and keeps full-resolution
          bytes; the column view's 120px cover and the narrow `left` cover use the thumbnail variant. */}
      {(effectiveLayout === "top" || effectiveLayout === "left") && item.coverPhotoId ? (
        <span className={styles.photoWrap}>
          {/* eslint-disable-next-line @next/next/no-img-element -- bytes are served by our audited auth
              route (/api/album-photo/[photoId]), not a static asset; next/image would proxy/optimize it. */}
          <img
            src={albumPhotoSrc(item.coverPhotoId, { thumb: !(masonry && effectiveLayout === "top") })}
            alt=""
            className={styles.cover}
            loading="lazy"
          />
        </span>
      ) : null}

      {effectiveLayout !== "wrap" && effectiveLayout !== "collage" ? (
        <div className={styles.body}>{bodyInner}</div>
      ) : null}
    </Link>
  );
}
