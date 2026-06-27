/**
 * Single-story page — the finished memoir surface. Original audio is one tap above the prose;
 * the prose itself is set in Newsreader, the title in a serif title face. All reads go through
 * the single front door (`getStoryForViewer`).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStoryForViewer, getElderProfile } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { KindredListenBar, KindredChip } from "@/app/_kindred";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function StoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  const story = await getStoryForViewer(db, ctx, id);
  if (!story) notFound();

  const elder = await getElderProfile(db, story.ownerPersonId);
  const elderName = elder?.spokenName ?? "the family";
  const recordedAt = (story.approvedAt ?? story.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const prose = story.prose ?? story.summary ?? "";
  const firstChar = prose.trimStart().charAt(0);
  const rest = prose.trimStart().slice(1);

  return (
    <main className="kin-page">
      <div className="kin-frame" style={{ padding: "0 clamp(20px, 5vw, 56px) clamp(28px, 5vw, 56px)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "22px 0",
          }}
        >
          <Link
            href="/hub"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 17,
              fontWeight: 600,
              color: "var(--text-meta)",
              textDecoration: "none",
            }}
          >
            <span style={{ fontSize: 22 }}>‹</span> Stories
          </Link>
        </div>

        <div className="kin-eyebrow">{formatEra(story.approvedAt ?? story.createdAt)}</div>
        <h1
          style={{
            fontSize: "clamp(34px, 5.5vw, 46px)",
            lineHeight: 1.08,
            letterSpacing: "-.01em",
            margin: "14px 0 18px",
          }}
        >
          {story.title ?? "Untitled"}
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--text-meta)", fontSize: 15 }}>
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "var(--support)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {elderName.charAt(0).toUpperCase()}
          </span>
          Told by {elderName} · Recorded {recordedAt}
        </div>

        <div style={{ margin: "22px 0" }}>
          <KindredListenBar src={`/api/media/${story.recordingMediaId}`} />
        </div>

        {prose ? (
          <p
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-story)",
              lineHeight: "var(--leading-loose)",
              color: "var(--text-body)",
              margin: "26px 0 0",
              whiteSpace: "pre-wrap",
            }}
          >
            <span
              style={{
                float: "left",
                fontFamily: "var(--font-story)",
                fontSize: 78,
                lineHeight: 0.74,
                fontWeight: 500,
                color: "var(--accent)",
                padding: "8px 14px 0 0",
              }}
            >
              {firstChar}
            </span>
            {rest}
          </p>
        ) : (
          <p className="kin-muted" style={{ marginTop: 26 }}>
            No prose yet — the original recording above is the whole story for now.
          </p>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 32 }}>
          <KindredChip kind="person" label={elderName} />
          <KindredChip kind="time" label={String((story.approvedAt ?? story.createdAt).getFullYear())} />
          <KindredChip kind="status" label={story.state.replace(/_/g, " ")} />
        </div>
      </div>
    </main>
  );
}

function formatEra(d: Date): string {
  const year = d.getFullYear();
  const month = d.toLocaleString(undefined, { month: "long" }).toUpperCase();
  return `${year} · ${month}`;
}
