import { KindredStoryCard } from "@/app/_kindred";
import type { ElderWithStories } from "@/lib/hub-data";

interface StoriesTabProps {
  feed: ElderWithStories[];
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

/**
 * Stories tab — renders the per-elder feed sections with KindredStoryCards.
 * Server component; receives already-authorized feed from the hub shell.
 */
export function StoriesTab({ feed }: StoriesTabProps) {
  if (feed.length === 0) {
    return (
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui)",
          color: "var(--text-muted)",
          margin: 0,
        }}
      >
        No families yet. When someone shares a chronicle with you, their stories will appear here.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      {feed.map((slot) => (
        <section key={`${slot.family.id}:${slot.elder.id}`}>
          {/* Elder / section heading */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 18,
            }}
          >
            <h2
              style={{
                fontFamily: "var(--font-story)",
                fontSize: "var(--text-story-lg)",
                fontWeight: 500,
                color: "var(--text-body)",
                margin: 0,
              }}
            >
              {slot.elder.spokenName}
            </h2>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-label)",
                color: "var(--text-muted)",
                letterSpacing: "var(--tracking-mono)",
              }}
            >
              {slot.family.name}
            </span>
          </div>

          {slot.stories.length === 0 ? (
            <p
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui-sm)",
                color: "var(--text-muted)",
                margin: 0,
              }}
            >
              No shared stories yet.
            </p>
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
        </section>
      ))}
    </div>
  );
}
