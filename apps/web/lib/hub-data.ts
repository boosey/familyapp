/**
 * Hub data loaders — read-only helpers the hub pages compose. Story content always flows through
 * `@chronicle/core`'s authorization function (`listStoriesForViewer`). Person/Membership/Family
 * lookups go through the open schema (those tables are not behind the front-door guard) and stay
 * narrow on purpose: identity-graph reads only.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { families, memberships, persons } from "@chronicle/db/schema";
import { listStoriesForViewer } from "@chronicle/core";
import type { AuthContext } from "@chronicle/core";
import type { Database, Family, Person, Story } from "@chronicle/db";

export interface MemberWithStories {
  person: Person;
  family: Family;
  stories: Story[];
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
      onboardedAt: persons.onboardedAt,
      biographicalAnchors: persons.biographicalAnchors,
      lifeStatus: persons.lifeStatus,
      accountId: persons.accountId,
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
