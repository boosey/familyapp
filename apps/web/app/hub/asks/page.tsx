/**
 * "Your asks" view — the hub notification surface. Closes the relay loop: the asker sees their
 * submitted questions and the status. For answered ones, the resulting Story is linked (via the
 * authorization function, so the asker only sees what they're permitted to read).
 */
import Link from "next/link";
import { getStoryForViewer, listAsksByAsker } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { KindredButton, KindredChip } from "@/app/_kindred";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AsksPage() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") {
    return (
      <main className="kin-page">
        <div className="kin-frame" style={{ padding: "clamp(28px, 5vw, 56px)" }}>
          <h1 style={{ fontSize: "var(--kin-text-title)", margin: 0 }}>Sign in to see your asks</h1>
          <Link href="/dev/sign-in" style={{ textDecoration: "none", display: "inline-block", maxWidth: 240, marginTop: 24 }}>
            <KindredButton label="Dev sign-in" />
          </Link>
        </div>
      </main>
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

  return (
    <main className="kin-page">
      <div className="kin-frame" style={{ padding: "clamp(28px, 5vw, 56px)" }}>
        <Link href="/hub" style={{ fontSize: 15, fontWeight: 600, color: "var(--kin-ink-2)", textDecoration: "none" }}>
          ‹ Back to hub
        </Link>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "var(--kin-text-title)", margin: 0 }}>Your asks</h1>
          <Link href="/hub/ask" style={{ textDecoration: "none" }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--kin-accent)" }}>+ Ask another</span>
          </Link>
        </div>

        {enriched.length === 0 ? (
          <p className="kin-muted" style={{ fontSize: "var(--kin-text-h3)", marginTop: 28 }}>
            You haven't asked anything yet.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "28px 0 0", display: "flex", flexDirection: "column", gap: 18 }}>
            {enriched.map((m) => (
              <li
                key={m.ask.id}
                style={{
                  background: "var(--kin-surface)",
                  border: "1px solid var(--kin-line)",
                  borderRadius: "var(--kin-radius-md)",
                  padding: "20px 22px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div className="kin-eyebrow">For {m.targetSpokenName}</div>
                  <KindredChip kind="status" label={prettyStatus(m.ask.status)} />
                </div>
                <p
                  style={{
                    fontFamily: "var(--kin-font-serif)",
                    fontSize: "var(--kin-text-h2)",
                    lineHeight: 1.25,
                    color: "var(--kin-ink)",
                    margin: 0,
                  }}
                >
                  {m.ask.questionText}
                </p>
                {m.ask.status === "answered" && m.storyVisible && m.ask.storyId ? (
                  <Link
                    href={`/hub/stories/${m.ask.storyId}`}
                    style={{ fontSize: 15, fontWeight: 600, color: "var(--kin-accent)", textDecoration: "none" }}
                  >
                    Listen{m.storyTitle ? `: ${m.storyTitle}` : ""} →
                  </Link>
                ) : null}
                {m.ask.status === "answered" && !m.storyVisible ? (
                  <span className="kin-muted" style={{ fontSize: 15 }}>
                    Answered — not shared with you.
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function prettyStatus(s: string): string {
  return s.replace(/_/g, " ");
}
