/**
 * Asks tab — the asker's outbox. Shows submitted questions and their status; links answered ones
 * to the resulting Story (via the authorization function so only permitted content is visible).
 * Server component; fetches asks and enriches with story visibility.
 */
import Link from "next/link";
import { getStoryForViewer, listAsksByAsker } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { hub } from "@/app/_copy";

export async function AsksTab({ scope = "all" }: { scope?: string } = {}) {
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
        {hub.asks.signedOut}
      </p>
    );
  }

  // Honor the hub's single family scope: "all" lists every ask the viewer sent; a family id restricts
  // to asks raised in that family (via ask_families). The scope is already validated upstream against
  // the viewer's own families.
  const mine = await listAsksByAsker(db, ctx, scope !== "all" ? { familyId: scope } : undefined);
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

  const heading = (
    <>
      <h2
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story-lg)",
          fontWeight: 500,
          color: "var(--text-body)",
          margin: 0,
        }}
      >
        {hub.asks.title}
      </h2>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          lineHeight: "var(--leading-body)",
          color: "var(--text-muted)",
          margin: "12px 0 0",
        }}
      >
        {hub.asks.intro}
      </p>
    </>
  );

  if (enriched.length === 0) {
    return (
      <div>
        {heading}
        <div
          style={{
            marginTop: 24,
            background: "var(--surface-card)",
            border: "var(--border-width) solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 30,
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-story)",
              color: "var(--text-muted)",
              margin: 0,
            }}
          >
            {hub.asks.empty}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {heading}
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "24px 0 0",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {enriched.map((m) => {
          const answeredVisible =
            m.ask.status === "answered" && m.storyVisible && m.ask.storyId;
          return (
            <li
              key={m.ask.id}
              style={{
                background: "var(--surface-card)",
                border: "var(--border-width) solid var(--border)",
                borderRadius: "var(--radius-lg)",
                boxShadow: "var(--shadow-card)",
                padding: "20px 24px",
                display: "flex",
                alignItems: "center",
                gap: 20,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--text-ui-sm)",
                    lineHeight: "var(--leading-snug)",
                    color: "var(--text-body)",
                    margin: 0,
                  }}
                >
                  <span style={{ color: "var(--text-meta)" }}>
                    {hub.asks.forTarget(m.targetSpokenName)}
                  </span>{" "}
                  {m.ask.questionText}
                </p>
              </div>

              {answeredVisible ? (
                <Link
                  href={`/hub/stories/${m.ask.storyId}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--text-ui-sm)",
                    fontWeight: 600,
                    color: "var(--accent-strong)",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  ▶ {m.storyTitle ?? hub.asks.listen}
                </Link>
              ) : m.ask.status === "answered" ? (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-label)",
                    letterSpacing: "var(--tracking-mono)",
                    color: "var(--support)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {hub.asks.answeredPrivate}
                </span>
              ) : (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-label)",
                    letterSpacing: "var(--tracking-mono)",
                    color: "var(--support)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {hub.asks.inQueue}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
