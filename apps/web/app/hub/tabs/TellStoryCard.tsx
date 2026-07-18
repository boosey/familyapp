import Link from "next/link";
import type { CSSProperties } from "react";
import { hub } from "@/app/_copy";

/**
 * The self-initiated "Tell a story" CTA (→ /hub/tell). Rendered as the FIRST item in the Story feed
 * (Feed mode) and standalone in the empty state, so the invitation to start a story leads the list.
 * Pure markup (no client hooks) — usable from both the server StoriesTab and the client StoryBrowse.
 * `masonry` adds the column-flow guards so it sits as the first masonry cell.
 */
export function TellStoryCard({ masonry = false }: { masonry?: boolean }) {
  return (
    <Link href="/hub/tell" style={masonry ? { ...cardStyle, ...masonryExtras } : cardStyle}>
      <span style={titleStyle}>{hub.stories.tellTitle}</span>
      <span style={blurbStyle}>{hub.stories.tellBlurb}</span>
      <span aria-hidden="true" style={actionStyle}>
        {hub.stories.tellAction}
      </span>
    </Link>
  );
}

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 10,
  // Skin-pluggable: the Playful skin sets a coral→amber gradient; heirloom a solid accent.
  background: "var(--tell-card-bg)",
  color: "var(--accent-on)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-card)",
  padding: "clamp(20px, 3vw, 30px) clamp(22px, 3vw, 34px)",
  textDecoration: "none",
};

const masonryExtras: CSSProperties = {
  breakInside: "avoid",
  marginBottom: 18,
  // Span every column in the CSS-columns masonry so the "Tell a story" invitation leads the feed
  // full-width rather than sitting as a narrow first cell.
  columnSpan: "all",
};

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "clamp(1.3rem, 2.6vw, 1.9rem)",
  fontWeight: 700,
  lineHeight: "var(--leading-snug)",
};

const blurbStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  lineHeight: "var(--leading-body)",
  opacity: 0.92,
  maxWidth: "46ch",
};

const actionStyle: CSSProperties = {
  marginTop: 4,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 38,
  height: 38,
  borderRadius: "var(--radius-pill)",
  background: "rgba(255, 255, 255, 0.24)",
  border: "1px solid rgba(255, 255, 255, 0.6)",
  color: "#fff",
  fontSize: "1.15rem",
  fontWeight: 600,
  lineHeight: 1,
};
