/**
 * Hub data loaders — read-only helpers the hub pages compose. Story content always flows through
 * `@chronicle/core`'s authorization function (`listStoriesForViewer`). Person/Membership/Family
 * lookups go through the open schema (those tables are not behind the front-door guard) and stay
 * narrow on purpose: identity-graph reads only.
 */
import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { families, memberships, persons } from "@chronicle/db/schema";
import { listStoriesForViewer } from "@chronicle/core";
import type { AuthContext } from "@chronicle/core";
import type { Database, Family, Person, Story } from "@chronicle/db";

export interface ElderWithStories {
  elder: Person;
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

/** Other active members of a family (excluding the viewer themselves). */
async function familyCoMembers(
  db: Database,
  familyId: string,
  viewerPersonId: string,
): Promise<Person[]> {
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
      and(
        eq(memberships.familyId, familyId),
        eq(memberships.status, "active"),
        ne(persons.id, viewerPersonId),
      ),
    );
}

/**
 * For an account-authenticated viewer, list every co-member elder in every family they belong
 * to, along with the elder's stories the viewer is authorized to read. Authorization is enforced
 * at the story layer by `listStoriesForViewer` — anything that should be invisible (private,
 * pending_approval, revoked) simply does not appear.
 */
export async function loadHubFeed(
  db: Database,
  ctx: AuthContext,
): Promise<ElderWithStories[]> {
  if (ctx.kind !== "account") return [];
  const fams = await viewerFamilyIds(db, ctx.personId);
  const out: ElderWithStories[] = [];
  for (const fam of fams) {
    const coMembers = await familyCoMembers(db, fam.id, ctx.personId);
    for (const elder of coMembers) {
      const stories = await listStoriesForViewer(db, ctx, {
        ownerPersonId: elder.id,
      });
      // Most-recent approval first; falls back to createdAt where approvedAt is null.
      stories.sort((a, b) => {
        const at = a.approvedAt?.getTime() ?? a.createdAt.getTime();
        const bt = b.approvedAt?.getTime() ?? b.createdAt.getTime();
        return bt - at;
      });
      out.push({ elder, family: fam, stories });
    }
  }
  return out;
}

/** All persons (dev sign-in picker only). */
export async function listAllPersons(db: Database): Promise<Person[]> {
  return db.select().from(persons);
}
