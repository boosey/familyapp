/**
 * "Your asks" view — the hub notification surface. Closes the relay loop: the asker sees their
 * submitted questions and their status. For answered ones, the resulting Story is linked (via
 * the authorization function, so the asker only sees what they're permitted to read).
 *
 * Phase 1: a polled view (no push). Spec Part III: "deliver answer back to asker (a
 * notification in the hub closing their loop)" — this is the notification.
 */
import Link from "next/link";
import { getStoryForViewer, listAsksByAsker } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AsksPage() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") {
    return (
      <main className="screen">
        <p>You need to <Link href="/dev/sign-in">sign in</Link>.</p>
      </main>
    );
  }
  const mine = await listAsksByAsker(db, ctx);
  // For answered asks, also resolve the linked Story via the front door so we only link to
  // stories the asker is authorized to read.
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
    <main className="screen">
      <h1>Your asks</h1>
      <p>
        <Link href="/hub">Back to hub</Link>
        {" · "}
        <Link href="/hub/ask">Ask another</Link>
      </p>
      {enriched.length === 0 ? (
        <p className="subtle">You haven't asked anything yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {enriched.map((m) => (
            <li key={m.ask.id} style={{ marginBottom: "1.25rem" }}>
              <div>
                <strong>For {m.targetSpokenName}:</strong> {m.ask.questionText}
              </div>
              <div className="subtle">
                Status: {m.ask.status}
                {m.ask.status === "answered" && m.storyVisible ? (
                  <>
                    {" · "}
                    <Link href={`/hub#story-${m.ask.storyId}`}>
                      Listen{m.storyTitle ? `: ${m.storyTitle}` : ""}
                    </Link>
                  </>
                ) : null}
                {m.ask.status === "answered" && !m.storyVisible ? (
                  <> · Answered (not shared with you)</>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
