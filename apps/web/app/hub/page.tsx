/**
 * The basic family hub — the younger-generation logged-in surface. Phase 1 scope (deliberately
 * thin): the approved-stories list with the elder's ORIGINAL VOICE primary and the cleaned-up
 * prose shown as secondary; pointers to invite + ask. Reads go strictly through
 * `@chronicle/core`'s authorization function via `loadHubFeed`.
 */
import Link from "next/link";
import { getRuntime } from "@/lib/runtime";
import { loadHubFeed } from "@/lib/hub-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HubPage() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  if (ctx.kind === "anonymous") {
    return (
      <main className="screen">
        <h1>Family Chronicle</h1>
        <p className="subtle">
          This is the family hub. Sign in to see your family's stories.
        </p>
        <p>
          <Link href="/dev/sign-in">Dev sign-in</Link>
        </p>
      </main>
    );
  }

  const feed = await loadHubFeed(db, ctx);

  return (
    <main className="screen">
      <h1>Family Chronicle</h1>
      <nav style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <Link href="/hub/invite">Invite an elder</Link>
        <Link href="/hub/ask">Ask a question</Link>
        <Link href="/hub/asks">Your asks</Link>
        <Link href="/dev/sign-in">Switch user</Link>
      </nav>
      {feed.length === 0 ? (
        <p className="subtle">
          No families yet. When someone shares a chronicle with you, their
          stories will appear here.
        </p>
      ) : (
        feed.map((slot) => (
          <section key={`${slot.family.id}:${slot.elder.id}`} style={{ marginBottom: "2rem" }}>
            <h2>
              {slot.elder.spokenName}
              <span className="subtle"> · {slot.family.name}</span>
            </h2>
            {slot.stories.length === 0 ? (
              <p className="subtle">No shared stories yet.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0 }}>
                {slot.stories.map((story) => (
                  <li key={story.id} id={`story-${story.id}`} style={{ marginBottom: "1.5rem" }}>
                    <h3>{story.title ?? "Untitled"}</h3>
                    {/* Original voice is PRIMARY — render it before the prose. */}
                    <audio
                      controls
                      preload="none"
                      src={`/api/media/${story.recordingMediaId}`}
                      style={{ display: "block", width: "100%" }}
                    />
                    {story.summary ? (
                      <p className="subtle" style={{ marginTop: "0.5rem" }}>
                        {story.summary}
                      </p>
                    ) : null}
                    {story.prose ? (
                      <details style={{ marginTop: "0.5rem" }}>
                        <summary className="subtle">Read the prose</summary>
                        <p style={{ whiteSpace: "pre-wrap" }}>{story.prose}</p>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </main>
  );
}
