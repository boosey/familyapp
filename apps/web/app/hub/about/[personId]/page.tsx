/**
 * "Stories about X" (issue #35) — the stories a given Person is tagged as a subject of, SCOPED to
 * the viewer's authorized stories. The core read `listStoriesAboutPerson` applies the same
 * authorization predicate as the rest of the front door, so the subject link only ever FILTERS: a
 * story the viewer cannot see never appears here, even if they are the tagged subject.
 */
import Link from "next/link";
import { listStoriesAboutPerson, getNarratorProfile } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { hub } from "@/app/_copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function StoriesAboutPersonPage({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const { personId } = await params;
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  const stories = await listStoriesAboutPerson(db, ctx, personId);
  const profile = await getNarratorProfile(db, personId);
  const name = profile?.spokenName || "them";

  return (
    <main style={{ minHeight: "100dvh", background: "var(--surface-page)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px clamp(16px, 4vw, 32px)" }}>
        <div style={{ marginBottom: 20 }}>
          <Link
            href="/hub"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-muted)",
              textDecoration: "none",
            }}
          >
            {hub.subjects.back}
          </Link>
        </div>

        <h1
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-story-lg)",
            fontWeight: 500,
            color: "var(--text-body)",
            margin: "0 0 24px",
          }}
        >
          {hub.subjects.storiesAboutHeading(name)}
        </h1>

        {stories.length === 0 ? (
          <p
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-story)",
              color: "var(--text-muted)",
              margin: 0,
            }}
          >
            {hub.subjects.storiesAboutEmpty}
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
            {stories.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/hub/stories/${s.id}`}
                  style={{
                    display: "block",
                    background: "var(--surface-card)",
                    border: "var(--border-width) solid var(--border)",
                    borderRadius: "var(--radius-lg)",
                    padding: "16px 20px",
                    fontFamily: "var(--font-story)",
                    fontSize: "var(--text-story)",
                    color: "var(--text-body)",
                    textDecoration: "none",
                  }}
                >
                  {s.title ?? s.summary ?? hub.stories.untitled}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
