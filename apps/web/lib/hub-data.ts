/**
 * Hub data loaders — read-only helpers the hub pages compose. Story content always flows through
 * `@chronicle/core`'s authorization function (`listStoriesForViewer`). Person/Membership/Family
 * lookups go through the open schema (those tables are not behind the front-door guard) and stay
 * narrow on purpose: identity-graph reads only.
 */
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { families, memberships, persons, storyFamilies, storyViews } from "@chronicle/db/schema";
import { listStoriesForViewer, loadStoryCovers, loadStoryGalleryPhotoIds } from "@chronicle/core";
import type { AuthContext } from "@chronicle/core";
import type { Database, Family, Person, Story } from "@chronicle/db";

export interface MemberWithStories {
  person: Person;
  family: Family;
  stories: Story[];
}

/** A family the viewer belongs to — the options for the Stories-tab family-scope filter. */
export interface ViewerFamilyRef {
  id: string;
  name: string;
}

/** Set of family ids the viewer holds an ACTIVE membership in. */
async function viewerFamilyIds(
  db: Database,
  personId: string,
): Promise<Family[]> {
  return db
    .select({
      id: families.id,
      name: families.name,
      description: families.description,
      discoverable: families.discoverable,
      creatorPersonId: families.creatorPersonId,
      stewardPersonId: families.stewardPersonId,
      createdAt: families.createdAt,
    })
    .from(memberships)
    .innerJoin(families, eq(families.id, memberships.familyId))
    .where(
      and(eq(memberships.personId, personId), eq(memberships.status, "active")),
    );
}

/** All active members of a family, INCLUDING the viewer themselves (the viewer sees their own
 *  stories on their hub, not just other people's). Deduping across families is the caller's job. */
async function familyMembers(db: Database, familyId: string): Promise<Person[]> {
  return db
    .select({
      id: persons.id,
      displayName: persons.displayName,
      spokenName: persons.spokenName,
      birthYear: persons.birthYear,
      birthDate: persons.birthDate,
      deathYear: persons.deathYear,
      deathDate: persons.deathDate,
      onboardedAt: persons.onboardedAt,
      biographicalAnchors: persons.biographicalAnchors,
      lifeStatus: persons.lifeStatus,
      sex: persons.sex,
      origin: persons.origin,
      identified: persons.identified,
      accountId: persons.accountId,
      createdByPersonId: persons.createdByPersonId,
      createdAt: persons.createdAt,
      updatedAt: persons.updatedAt,
    })
    .from(memberships)
    .innerJoin(persons, eq(persons.id, memberships.personId))
    .where(
      and(eq(memberships.familyId, familyId), eq(memberships.status, "active")),
    );
}

/**
 * For an account-authenticated viewer, list every active member in every family they belong to —
 * INCLUDING the viewer themselves, so a narrator who is logged in sees their own stories — along
 * with that member's stories the viewer is authorized to read (regardless of role). Authorization
 * is enforced at the story layer by `listStoriesForViewer`: anything that should be invisible to a
 * non-owner (private, pending_approval, revoked) simply does not appear, while the owner always
 * sees their own content in any state.
 *
 * Each person is emitted once even if shared across several of the viewer's families (deduped by
 * person id, attributed to the first such family) — otherwise their stories would render twice.
 */
export async function loadHubFeed(
  db: Database,
  ctx: AuthContext,
): Promise<MemberWithStories[]> {
  if (ctx.kind !== "account") return [];
  const fams = await viewerFamilyIds(db, ctx.personId);

  // person id -> the (person, representative family) to show them under. First family wins.
  const byPerson = new Map<string, { person: Person; family: Family }>();
  for (const fam of fams) {
    for (const member of await familyMembers(db, fam.id)) {
      if (!byPerson.has(member.id)) byPerson.set(member.id, { person: member, family: fam });
    }
  }

  const out: MemberWithStories[] = [];
  for (const { person, family } of byPerson.values()) {
    const stories = await listStoriesForViewer(db, ctx, { ownerPersonId: person.id });
    // Most-recent approval first; falls back to createdAt where approvedAt is null.
    stories.sort((a, b) => {
      const at = a.approvedAt?.getTime() ?? a.createdAt.getTime();
      const bt = b.approvedAt?.getTime() ?? b.createdAt.getTime();
      return bt - at;
    });
    out.push({ person, family, stories });
  }
  return out;
}

/** All persons (dev sign-in picker only). */
export async function listAllPersons(db: Database): Promise<Person[]> {
  return db.select().from(persons);
}

/**
 * The families the account viewer belongs to (active membership) — the options for the Stories-tab
 * family-scope filter. Anonymous viewers get none. Identity-graph read over the open schema.
 */
export async function loadViewerFamilies(
  db: Database,
  ctx: AuthContext,
): Promise<ViewerFamilyRef[]> {
  if (ctx.kind !== "account") return [];
  const fams = await viewerFamilyIds(db, ctx.personId);
  return fams.map((f) => ({ id: f.id, name: f.name }));
}

/**
 * For each of `storyIds`, the families it is TARGETED to (`story_families`) — but ONLY families the
 * viewer themselves is an active member of (the intersection is done in SQL via `viewerFamilyIds`).
 * This keeps a story card from ever naming a family the viewer isn't in, and mirrors exactly which
 * scopes the family-scope filter can select. `story_families` is an authz INPUT in the open schema
 * (ADR-0010), not Story content, so it is read directly — the story ids were already authorized by
 * the feed load. Stories with no in-scope target simply have no entry in the returned map.
 */
export async function loadStoryFamilyTargets(
  db: Database,
  storyIds: string[],
  viewerFamilyIds: string[],
): Promise<Map<string, ViewerFamilyRef[]>> {
  const map = new Map<string, ViewerFamilyRef[]>();
  if (storyIds.length === 0 || viewerFamilyIds.length === 0) return map;
  const rows = await db
    .select({
      storyId: storyFamilies.storyId,
      familyId: families.id,
      familyName: families.name,
    })
    .from(storyFamilies)
    .innerJoin(families, eq(families.id, storyFamilies.familyId))
    .where(
      and(
        inArray(storyFamilies.storyId, storyIds),
        inArray(storyFamilies.familyId, viewerFamilyIds),
      ),
    );
  for (const r of rows) {
    const arr = map.get(r.storyId);
    if (arr) arr.push({ id: r.familyId, name: r.familyName });
    else map.set(r.storyId, [{ id: r.familyId, name: r.familyName }]);
  }
  return map;
}

/**
 * For each of `storyIds`, its cover accompaniment photo id (ADR-0009 Phase 2), if any. `story_images`
 * is a GUARDED content table, so this goes through the audited `loadStoryCovers` core seam (batched,
 * mirroring `loadStoryFamilyTargets`) — never a direct table read. The ids were already authorized by
 * the feed load; the seam excludes soft-deleted photos, so a deleted cover simply drops out of the
 * map. A story with no renderable image has no entry (→ a text-only card, no placeholder).
 */
export async function loadStoryCoverPhotoIds(
  db: Database,
  storyIds: string[],
): Promise<Map<string, string>> {
  if (storyIds.length === 0) return new Map();
  return loadStoryCovers(db, storyIds);
}

/**
 * For each of `storyIds`, ALL of its renderable accompaniment photo ids in render order (cover first),
 * via the audited batched `loadStoryGalleryPhotoIds` core seam — the gallery sibling of
 * `loadStoryCoverPhotoIds`. Drives the feed card's non-cover thumbnail row (the card renders the cover
 * big and the rest small). Soft-deleted photos are excluded; a text-only story has no entry.
 */
export async function loadStoryPhotoIds(
  db: Database,
  storyIds: string[],
): Promise<Map<string, string[]>> {
  if (storyIds.length === 0) return new Map();
  return loadStoryGalleryPhotoIds(db, storyIds);
}

/**
 * Which of `storyIds` the viewer has already opened. Drives the "New" badge: a story is new to a
 * viewer until a row exists. `story_views` is viewer read-state, not Story content, so it is read
 * directly (no front-door auth) — the ids themselves were already authorized by the feed load.
 * Scoped to the candidate ids so the query stays bounded as a viewer's history grows.
 */
export async function loadSeenStoryIds(
  db: Database,
  personId: string,
  storyIds: string[],
): Promise<Set<string>> {
  if (storyIds.length === 0) return new Set();
  const rows = await db
    .select({ storyId: storyViews.storyId })
    .from(storyViews)
    .where(and(eq(storyViews.personId, personId), inArray(storyViews.storyId, storyIds)));
  return new Set(rows.map((r) => r.storyId));
}

/**
 * Record that `personId` has opened `storyId`. Idempotent via the (story_id, person_id) unique
 * index — re-opening a story is a no-op. Called from the story detail page AFTER the read has been
 * authorized through the front door, so this never grants or implies any content access itself.
 */
export async function markStorySeen(
  db: Database,
  storyId: string,
  personId: string,
): Promise<void> {
  await db
    .insert(storyViews)
    .values({ storyId, personId })
    .onConflictDoNothing({ target: [storyViews.storyId, storyViews.personId] });
}
