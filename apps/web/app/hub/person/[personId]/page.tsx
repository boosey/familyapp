/**
 * /hub/person/[personId] — the per-person "contributions" page (tree Slice B).
 *
 * One page, three deep-linkable sections (`?section=stories|photos|mentions`, default `stories`):
 *   - Stories contributed — stories this person NARRATED / OWNS (`listStoriesNarratedByPerson`).
 *   - Photos contributed — album photos this person contributed (`listPhotosContributedByPerson`).
 *   - Mentions — stories this person is ABOUT (`listStoriesAboutPerson`, folded in from /hub/about).
 *
 * Front-door discipline (load-bearing): all three are CONTENT reads through @chronicle/core. Each
 * NARROWS via an authorized predicate and NEVER grants — the viewer only ever sees the subset they
 * were already entitled to, filtered to this person's contributions. An unauthorized viewer simply
 * gets empty tabs; nothing leaks. Photo bytes are served by the audited /api/album-photo/[photoId].
 *
 * Auth: account only, gated like the rest of the hub (anonymous → landing; family-less /
 * not-onboarded → the step they still owe). Person visibility: the person must be resolvable
 * (`getNarratorProfile`); a missing id is a 404. The three reads then self-gate the content.
 */
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  canViewerSeePerson,
  getNarratorProfile,
  listStoriesAboutPerson,
  listStoriesNarratedByPerson,
  listPhotosContributedByPerson,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import { hub } from "@/app/_copy";
import {
  PersonContributions,
  type PersonPhotoCard,
  type PersonSection,
  type PersonStoryCard,
} from "./PersonContributions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECTIONS = new Set<PersonSection>(["stories", "photos", "mentions"]);

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const { personId } = await params;
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/");

  const dest = await resolvePostAuthRoute(db, ctx.personId);
  if (dest !== "/hub") redirect(dest);

  // Person VISIBILITY gate (viewer-scoped): the viewer must actually be able to see this person in a
  // family they can browse (same reachability the tree renderer enforces) — self always visible. On
  // failure we return notFound() so a HIDDEN person is indistinguishable from a NONEXISTENT id: no
  // existence oracle, and — critically — no name/identity disclosure (the <h1> below would otherwise
  // leak the spoken name of an unrelated person in a different family). Must run BEFORE getNarratorProfile.
  if (!(await canViewerSeePerson(db, ctx, personId))) notFound();
  const profile = await getNarratorProfile(db, personId);
  if (!profile) notFound();
  const name = profile.spokenName?.trim() || hub.personPage.headingFallback;

  const sp = await searchParams;
  const raw = typeof sp.section === "string" ? sp.section : "stories";
  const section: PersonSection = SECTIONS.has(raw as PersonSection)
    ? (raw as PersonSection)
    : "stories";

  // All three authorized reads (each narrows to the viewer's authorized subset). Lightweight cards
  // only — no prose bytes, no media bytes (thumbnails come from the audited byte route on demand).
  const [narrated, contributed, mentions] = await Promise.all([
    listStoriesNarratedByPerson(db, ctx, personId),
    listPhotosContributedByPerson(db, ctx, personId),
    listStoriesAboutPerson(db, ctx, personId),
  ]);

  const toStoryCard = (s: { id: string; title: string | null; summary: string | null }): PersonStoryCard => ({
    id: s.id,
    title: s.title,
    summary: s.summary,
  });
  const stories: PersonStoryCard[] = narrated.map(toStoryCard);
  const mentionCards: PersonStoryCard[] = mentions.map(toStoryCard);
  const photos: PersonPhotoCard[] = contributed.map((p) => ({ id: p.id, caption: p.caption }));

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
            {hub.personPage.back}
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
          {hub.personPage.headingFor(name)}
        </h1>

        <PersonContributions
          initialSection={section}
          stories={stories}
          photos={photos}
          mentions={mentionCards}
        />
      </div>
    </main>
  );
}
