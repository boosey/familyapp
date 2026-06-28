/**
 * THE SINGLE FRONT DOOR.
 *
 * Every read of Story or Media content in the entire system goes through this module. There is
 * no other supported path that returns story/media content. The functions here resolve the
 * story owner's ACTIVE memberships and evaluate the requester against the story's audience tier.
 *
 * Design rules (Phase 0, enforced from line one):
 *   - `private`  -> author/owner only.
 *   - `branch`   -> treated as `family` for enforcement in Phase 0 (the stored tier value is
 *                   kept faithfully and is non-lossy; branch structure is a later seam).
 *   - `family`   -> any Person who shares an ACTIVE membership with the owner in some Family.
 *   - `public`   -> open.
 *   - A non-owner may NEVER see a story until it is in `approved`/`shared` state AND the consent
 *     ledger's latest sharing event is `approved_for_sharing` (a later `revoked` row hides it
 *     again — revocation is a new row, never an edit).
 *   - The owner (incl. the token-scoped narrator reading their own archive) always sees their own
 *     content in any state.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
// Content tables come from the GUARDED subpath. This file is on the architecture-test allowlist
// precisely because it IS the single front door. Non-content tables come from /schema (open).
import { media as mediaTable, stories } from "@chronicle/db/content";
import { consentRecords, memberships } from "@chronicle/db/schema";
import type { Database, Media, Story } from "@chronicle/db";

/**
 * Who is asking. The anonymous narrator surface authenticates with nothing but a session token;
 * that token resolves to the narrator's own Person id, so they arrive here as `link_session` and
 * are treated as the owner of their own stories. There is no account/login on that path.
 */
export type AuthContext =
  | { readonly kind: "anonymous" }
  | { readonly kind: "account"; readonly personId: string }
  | { readonly kind: "link_session"; readonly personId: string };

export type AuthDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

const DENY = (reason: string): AuthDecision => ({ allowed: false, reason });
const ALLOW: AuthDecision = { allowed: true };

/** The Person the context speaks for, or null for a truly anonymous request. */
export function viewerPersonId(ctx: AuthContext): string | null {
  return ctx.kind === "anonymous" ? null : ctx.personId;
}

/** Family ids in which the person currently holds an ACTIVE membership. */
async function activeFamilyIds(
  db: Database,
  personId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ familyId: memberships.familyId })
    .from(memberships)
    .where(
      and(eq(memberships.personId, personId), eq(memberships.status, "active")),
    );
  return new Set(rows.map((r) => r.familyId));
}

/**
 * The story's CURRENT sharing consent, computed from the append-only ledger: the most recent
 * sharing-related event (`approved_for_sharing` vs `revoked`) wins. Returns false if there has
 * never been an approval. This is why revocation is a new row — it simply becomes the latest.
 */
async function hasActiveSharingConsent(
  db: Database,
  storyId: string,
): Promise<boolean> {
  const rows = await db
    .select({ action: consentRecords.action })
    .from(consentRecords)
    .where(
      and(
        eq(consentRecords.storyId, storyId),
        inArray(consentRecords.action, ["approved_for_sharing", "revoked"]),
      ),
    )
    .orderBy(desc(consentRecords.seq))
    .limit(1);
  return rows[0]?.action === "approved_for_sharing";
}

/**
 * The core authorization decision for reading a Story. Pure-ish: it only reads (memberships,
 * consent ledger) and returns allow/deny. All public read helpers funnel through this.
 */
export async function decideStoryRead(
  db: Database,
  ctx: AuthContext,
  story: Pick<Story, "id" | "ownerPersonId" | "state" | "audienceTier">,
): Promise<AuthDecision> {
  const viewer = viewerPersonId(ctx);

  // The owner (and the token-scoped narrator) always sees their own content, any state, any tier.
  if (viewer !== null && viewer === story.ownerPersonId) return ALLOW;

  // Public is the only tier visible without sharing consent + an approved/shared state...
  // ...but even public still requires the story to have been approved & shared by the author.
  const consented =
    (story.state === "approved" || story.state === "shared") &&
    (await hasActiveSharingConsent(db, story.id));
  if (!consented) {
    return DENY(
      "story is not approved+shared with a backing consent record (or consent was revoked)",
    );
  }

  switch (story.audienceTier) {
    case "private":
      return DENY("audience tier is private (author only)");
    case "public":
      return ALLOW;
    case "branch":
    case "family": {
      // Phase 0: branch is enforced as family. Co-membership in any family grants access.
      if (viewer === null) {
        return DENY("anonymous request cannot read a family-tier story");
      }
      const [ownerFamilies, viewerFamilies] = await Promise.all([
        activeFamilyIds(db, story.ownerPersonId),
        activeFamilyIds(db, viewer),
      ]);
      for (const fid of viewerFamilies) {
        if (ownerFamilies.has(fid)) return ALLOW;
      }
      return DENY("viewer shares no active family membership with the author");
    }
    default: {
      // Exhaustiveness guard: a new tier must be handled explicitly, never default-allow.
      const _exhaustive: never = story.audienceTier;
      return DENY(`unhandled audience tier: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Authorization for reading a Media asset. Media is reachable only:
 *   - by its owner (the narrator owns their recordings and approval clips), or
 *   - as the canonical recording of a Story the viewer is allowed to read.
 * Approval-audio clips are therefore owner-only (they are not a story's recording), which is
 * the intended Phase-1 behavior.
 */
export async function decideMediaRead(
  db: Database,
  ctx: AuthContext,
  m: Pick<Media, "id" | "ownerPersonId">,
): Promise<AuthDecision> {
  const viewer = viewerPersonId(ctx);
  if (viewer !== null && viewer === m.ownerPersonId) return ALLOW;

  const referencing = await db
    .select({
      id: stories.id,
      ownerPersonId: stories.ownerPersonId,
      state: stories.state,
      audienceTier: stories.audienceTier,
    })
    .from(stories)
    .where(eq(stories.recordingMediaId, m.id));

  for (const s of referencing) {
    const decision = await decideStoryRead(db, ctx, s);
    if (decision.allowed) return ALLOW;
  }
  return DENY("media is not owned by viewer and backs no readable story");
}

// ---------------------------------------------------------------------------
// The public read API — the ONLY supported way to obtain Story/Media content.
// Each helper fetches a candidate and then funnels it through the decision above. There is no
// helper that returns content without a decision, and the raw db client is not re-exported for
// story/media reads from this package.
// ---------------------------------------------------------------------------

/** Returns the Story iff the viewer is authorized; otherwise null (no content leaks). */
export async function getStoryForViewer(
  db: Database,
  ctx: AuthContext,
  storyId: string,
): Promise<Story | null> {
  const [story] = await db
    .select()
    .from(stories)
    .where(eq(stories.id, storyId))
    .limit(1);
  if (!story) return null;
  const decision = await decideStoryRead(db, ctx, story);
  return decision.allowed ? story : null;
}

/**
 * Lists stories visible to the viewer, optionally narrowed to one owner (e.g. the hub showing a
 * single narrator's approved stories). Every candidate is filtered through the same decision — the
 * single front door — so the list can never surface something a point read would deny.
 */
export async function listStoriesForViewer(
  db: Database,
  ctx: AuthContext,
  opts: { ownerPersonId?: string } = {},
): Promise<Story[]> {
  const rows = opts.ownerPersonId
    ? await db
        .select()
        .from(stories)
        .where(eq(stories.ownerPersonId, opts.ownerPersonId))
    : await db.select().from(stories);

  const visible: Story[] = [];
  for (const story of rows) {
    const decision = await decideStoryRead(db, ctx, story);
    if (decision.allowed) visible.push(story);
  }
  return visible;
}

/** Returns the Media iff the viewer is authorized; otherwise null. */
export async function getMediaForViewer(
  db: Database,
  ctx: AuthContext,
  mediaId: string,
): Promise<Media | null> {
  const [m] = await db
    .select()
    .from(mediaTable)
    .where(eq(mediaTable.id, mediaId))
    .limit(1);
  if (!m) return null;
  const decision = await decideMediaRead(db, ctx, m);
  return decision.allowed ? m : null;
}
