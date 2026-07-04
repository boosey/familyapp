/**
 * Single-story "Read + Listen" page — the finished memoir surface. Original audio sits one tap
 * above the prose (the Kindred listen bar); the reader can flip between the rendered prose and the
 * raw transcript. All content reads go through the single front door (`getStoryForViewer`).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStoryForViewer, getNarratorProfile, listStoryImages } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { markStorySeen, loadStoryFamilyTargets, loadViewerFamilies } from "@/lib/hub-data";
import { KindredListenBar } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import { StoryReadBody } from "./StoryReadBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Next 15 delivers a single value or (for repeated keys) an array; take the first. */
function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Era·place label from the era the story is ABOUT (not when it was recorded). */
function eraLabel(eraYear: number | null, eraPlace: string | null): string {
  if (eraYear != null && eraPlace) return `${eraYear} · ${eraPlace}`;
  if (eraYear != null) return String(eraYear);
  return hub.browse.undated;
}

/** Up-to-two-letter initials for the narrator avatar. */
function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
  return letters || "?";
}

export default async function StoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string | string[]; scope?: string | string[] }>;
}) {
  const { id } = await params;
  const { from, scope } = await searchParams;
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  const story = await getStoryForViewer(db, ctx, id);
  if (!story) notFound();

  // Opening an authorized story marks it seen for this viewer, clearing its "New" badge on the hub.
  // Owners reading their own story still record a view; the badge logic excludes owners anyway.
  if (ctx.kind === "account") {
    await markStorySeen(db, story.id, ctx.personId);
  }

  const narrator = await getNarratorProfile(db, story.ownerPersonId);
  const narratorName = narrator?.spokenName ?? "the family";

  // Accompaniment gallery (ADR-0009 Phase 2). The parent story was gated by getStoryForViewer above,
  // so its images are visible to this viewer; the seam excludes soft-deleted photos. Family-photo
  // provenance only in Phase 2 (illustrations, with a null familyPhotoId, are a later slice). Bytes
  // flow through the audited /api/album-photo/[photoId] route.
  const storyImages = (await listStoryImages(db, story.id)).filter(
    (img): img is typeof img & { familyPhotoId: string } => img.familyPhotoId !== null,
  );

  // Family pills: only families the story is targeted to AND the viewer belongs to (intersection in
  // SQL). Never names a family the viewer isn't in; mirrors the browse-surface scope filter.
  const viewerFamilies = await loadViewerFamilies(db, ctx);
  const targets =
    (await loadStoryFamilyTargets(db, [story.id], viewerFamilies.map((f) => f.id))).get(story.id) ??
    [];

  // Back link restores the prior browse state (the card links here as ?from={mode}&scope={scope}).
  const backParams = new URLSearchParams({ tab: "stories" });
  const fromMode = first(from);
  const backScope = first(scope);
  if (fromMode) backParams.set("mode", fromMode);
  if (backScope) backParams.set("scope", backScope);
  const backHref = `/hub?${backParams.toString()}`;

  const tags = story.tags ?? [];

  return (
    <main className="kin-page">
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "clamp(20px, 5vw, 40px) clamp(20px, 5vw, 56px) 80px",
        }}
      >
        <Link
          href={backHref}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            fontWeight: 600,
            color: "var(--accent-strong)",
            textDecoration: "none",
            marginBottom: 20,
          }}
        >
          ‹ {hub.browse.back}
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "var(--accent-soft)",
              color: "var(--accent-strong)",
              fontFamily: "var(--font-story)",
              fontSize: 18,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "0 0 auto",
            }}
          >
            {initialsOf(narratorName)}
          </span>
          <span
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-label)",
              color: "var(--text-meta)",
            }}
          >
            {hub.browse.toldBy(narratorName)}
          </span>
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: "var(--border-strong)",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-label)",
              letterSpacing: "var(--tracking-mono)",
              color: "var(--support)",
            }}
          >
            {eraLabel(story.eraYear ?? null, story.eraLabel ?? null)}
          </span>
        </div>

        <h1
          style={{
            fontFamily: "var(--font-story)",
            fontWeight: 400,
            fontSize: "clamp(var(--text-display), 5.5vw, var(--text-display-lg))",
            lineHeight: 1.15,
            color: "var(--text-body)",
            margin: "16px 0 20px",
          }}
        >
          {story.title ?? hub.stories.untitled}
        </h1>

        {(tags.length > 0 || targets.length > 0) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
            {tags.map((tag) => (
              <span
                key={`t-${tag}`}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-label)",
                  fontWeight: 500,
                  color: "var(--text-muted)",
                  border: "1.5px solid var(--border-strong)",
                  borderRadius: "var(--radius-pill)",
                  padding: "5px 13px",
                }}
              >
                {tag}
              </span>
            ))}
            {targets.map((fam) => (
              <span
                key={`f-${fam.id}`}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-label)",
                  fontWeight: 500,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: "var(--accent-strong)",
                  background: "var(--accent-soft)",
                  borderRadius: "var(--radius-pill)",
                  padding: "5px 13px",
                }}
              >
                {fam.name}
              </span>
            ))}
          </div>
        )}

        <KindredListenBar
          src={`/api/media/${story.recordingMediaId}`}
          title={hub.browse.readListenTitle(narratorName)}
        />

        <div style={{ marginTop: 28 }}>
          <StoryReadBody
            prose={story.prose ?? story.summary ?? null}
            transcript={story.transcript ?? null}
            labels={{
              story: hub.browse.readStory,
              transcript: hub.browse.readTranscript,
              noProse: hub.browse.readNoProse,
            }}
          />
        </div>

        {/* Accompaniment gallery — only when the story has attached (non-deleted) photos. */}
        {storyImages.length > 0 ? (
          <section style={{ marginTop: 40 }}>
            <h2
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-label)",
                letterSpacing: "var(--tracking-mono)",
                textTransform: "uppercase",
                color: "var(--text-meta)",
                margin: "0 0 16px",
              }}
            >
              {hub.storyImages.galleryHeading}
            </h2>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 12,
              }}
            >
              {storyImages.map((img) => (
                <li key={img.id} style={{ margin: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- bytes are served by our
                      audited auth route, not a static asset; next/image would proxy/optimize it. */}
                  <img
                    src={`/api/album-photo/${img.familyPhotoId}`}
                    alt={hub.storyImages.galleryAlt(img.caption)}
                    style={{
                      width: "100%",
                      aspectRatio: "1 / 1",
                      objectFit: "cover",
                      borderRadius: "var(--radius-sm)",
                      display: "block",
                      background: "var(--surface-sunken)",
                    }}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
