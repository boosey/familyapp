/**
 * Asks tab — the asker's outbox. Shows submitted questions and their status; links answered ones
 * to the resulting Story (via the authorization function so only permitted content is visible).
 * Server component; fetches asks and enriches with story visibility.
 */
import Link from "next/link";
import { getStoryForViewer, listAsksByAsker } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { KindredChip } from "@/app/_kindred";

export async function AsksTab() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  if (ctx.kind !== "account") {
    return (
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui)",
          color: "var(--text-muted)",
        }}
      >
        Sign in to see your asks.
      </p>
    );
  }

  const mine = await listAsksByAsker(db, ctx);
  const enriched = await Promise.all(
    mine.map(async (m) => {
      let storyVisible = false;
      let storyTitle: string | null = null;
      if (m.ask.status === "answered" && m.ask.storyId) {
        const story = await getStoryForViewer(db, ctx, m.ask.storyId);
        if (story) {
          storyVisible = true;
          storyTitle = story.title;
        }
      }
      return { ...m, storyVisible, storyTitle };
    }),
  );

  if (enriched.length === 0) {
    return (
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui)",
          color: "var(--text-muted)",
          margin: 0,
        }}
      >
        You haven&apos;t asked anything yet.
      </p>
    );
  }

  return (
    <div>
      <h2
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story-lg)",
          fontWeight: 500,
          color: "var(--text-body)",
          margin: "0 0 24px",
        }}
      >
        Your asks
      </h2>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {enriched.map((m) => (
          <li
            key={m.ask.id}
            style={{
              background: "var(--surface-card)",
              border: "var(--border-width) solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: "20px 22px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "flex-start",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-label)",
                  color: "var(--text-meta)",
                  letterSpacing: "var(--tracking-mono)",
                }}
              >
                FOR {m.targetSpokenName.toUpperCase()}
              </span>
              <KindredChip kind="status" label={prettyStatus(m.ask.status)} />
            </div>
            <p
              style={{
                fontFamily: "var(--font-story)",
                fontSize: "var(--text-story-lg)",
                lineHeight: "var(--leading-snug)",
                color: "var(--text-body)",
                margin: 0,
              }}
            >
              {m.ask.questionText}
            </p>
            {m.ask.status === "answered" && m.storyVisible && m.ask.storyId ? (
              <Link
                href={`/hub/stories/${m.ask.storyId}`}
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--accent)",
                  textDecoration: "none",
                }}
              >
                Listen{m.storyTitle ? `: ${m.storyTitle}` : ""} →
              </Link>
            ) : null}
            {m.ask.status === "answered" && !m.storyVisible ? (
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-label)",
                  color: "var(--text-muted)",
                }}
              >
                Answered — not shared with you.
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function prettyStatus(s: string): string {
  return s.replace(/_/g, " ");
}
