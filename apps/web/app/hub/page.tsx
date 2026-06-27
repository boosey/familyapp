/**
 * The family hub — the younger-generation logged-in surface, dressed in Kindred's Timeline kit.
 * Reads strictly through `@chronicle/core`'s authorization function via `loadHubFeed`.
 */
import Link from "next/link";
import { getRuntime } from "@/lib/runtime";
import { loadHubFeed } from "@/lib/hub-data";
import { KindredButton, KindredStoryCard } from "@/app/_kindred";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HubPage() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  if (ctx.kind === "anonymous") {
    return (
      <main className="kin-page">
        <div className="kin-frame" style={{ padding: "clamp(32px, 6vw, 64px)" }}>
          <h1 style={{ fontSize: "var(--kin-text-title)", margin: 0 }}>Family Chronicle</h1>
          <p className="kin-ink-2" style={{ fontSize: "var(--kin-text-h3)", marginTop: 16 }}>
            This is the family hub. Sign in to see your family's stories.
          </p>
          <div style={{ maxWidth: 260, marginTop: 28 }}>
            <Link href="/dev/sign-in" style={{ textDecoration: "none" }}>
              <KindredButton label="Dev sign-in" fullWidth />
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const feed = await loadHubFeed(db, ctx);
  const totalStories = feed.reduce((n, s) => n + s.stories.length, 0);

  return (
    <main className="kin-page">
      <div className="kin-frame">
        <header
          style={{
            padding: "30px clamp(20px, 5vw, 36px) 22px",
            borderBottom: "1px solid var(--kin-line)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: "clamp(28px, 4.5vw, 38px)", margin: 0, letterSpacing: "-.01em" }}>
              {feed.length === 1 ? `${feed[0]!.elder.spokenName}'s chronicle` : "Your family's stories"}
            </h1>
            <nav style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/hub/invite" className="hub-nav-link">Invite an elder</Link>
              <Link href="/hub/ask" className="hub-nav-link">Ask a question</Link>
              <Link href="/hub/asks" className="hub-nav-link">Your asks</Link>
              <Link href="/dev/sign-in" className="hub-nav-link kin-muted">Switch user</Link>
            </nav>
          </div>
          <div className="kin-muted" style={{ fontSize: 16 }}>
            {totalStories === 0
              ? "Stories will land here as soon as they're shared with you."
              : `${totalStories} ${totalStories === 1 ? "memory" : "memories"} gathered · ${feed.length} ${feed.length === 1 ? "elder" : "elders"}`}
          </div>
        </header>

        <section style={{ padding: "30px clamp(20px, 5vw, 36px)", display: "flex", flexDirection: "column", gap: 36 }}>
          {feed.length === 0 ? (
            <p className="kin-muted" style={{ fontSize: "var(--kin-text-h3)", margin: 0 }}>
              No families yet. When someone shares a chronicle with you, their stories will appear here.
            </p>
          ) : (
            feed.map((slot) => (
              <div key={`${slot.family.id}:${slot.elder.id}`} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <h2 style={{ fontSize: "var(--kin-text-h2)", margin: 0, fontFamily: "var(--kin-font-serif)", fontWeight: 500 }}>
                    {slot.elder.spokenName}
                  </h2>
                  <span className="kin-muted mono" style={{ fontSize: 13 }}>{slot.family.name}</span>
                </div>
                {slot.stories.length === 0 ? (
                  <p className="kin-muted" style={{ margin: 0 }}>No shared stories yet.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {slot.stories.map((story) => {
                      const eraDate = story.approvedAt ?? story.createdAt;
                      const era = formatEra(eraDate);
                      const meta: string[] = [];
                      if (story.summary) meta.push(truncate(story.summary, 80));
                      return (
                        <KindredStoryCard
                          key={story.id}
                          era={era}
                          title={story.title ?? "Untitled"}
                          byline={`Told by ${slot.elder.spokenName}`}
                          meta={meta}
                          href={`/hub/stories/${story.id}`}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </section>
      </div>

      <style>{`
        .hub-nav-link {
          display: inline-flex;
          align-items: center;
          padding: 10px 16px;
          font-size: 15px;
          font-weight: 600;
          color: var(--kin-ink-2);
          border: 1.5px solid var(--kin-field);
          border-radius: 999px;
          background: transparent;
        }
        .hub-nav-link:hover { background: var(--kin-tint); border-color: var(--kin-accent); color: var(--kin-accent); text-decoration: none; }
      `}</style>
    </main>
  );
}

function formatEra(d: Date): string {
  const year = d.getFullYear();
  const month = d.toLocaleString(undefined, { month: "long" }).toUpperCase();
  return `${year} · ${month}`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
