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
      <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <span style={titleStyle}>{hub.stories.tellTitle}</span>
        <span style={blurbStyle}>{hub.stories.tellBlurb}</span>
      </span>
      <span aria-hidden="true" style={{ fontSize: "1.25rem", flex: "0 0 auto" }}>
        →
      </span>
    </Link>
  );
}

const cardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 20,
  background: "var(--accent)",
  color: "var(--accent-on)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-card)",
  padding: "20px 24px",
  textDecoration: "none",
};

const masonryExtras: CSSProperties = {
  breakInside: "avoid",
  marginBottom: 18,
};

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-story)",
  fontSize: "var(--text-story)",
  fontWeight: 500,
};

const blurbStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  opacity: 0.85,
};
