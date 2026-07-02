/**
 * Explore read layer (ADR-0010/0011): the family-scoped, paginated, recency-ordered feed that the
 * Explore surface reads through. Every option composes ON TOP of the visibility predicate and can
 * only narrow — these tests pin that, especially the family-scope filter's two safety properties:
 * it never widens the authorized set, and it never reveals a family the viewer isn't a member of.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { stories } from "@chronicle/db/content";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listStoriesForViewer } from "../src/index";
import {
  addMembership,
  makeFamily,
  makePerson,
  makeStory,
} from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string) => ({ kind: "account" as const, personId });
const anon = { kind: "anonymous" as const };

/** A shared, consented, family-tier story targeted to `familyIds` — visible to co-members. */
async function sharedStory(ownerPersonId: string, familyIds: string[]) {
  const { story } = await makeStory(db, {
    ownerPersonId,
    state: "shared",
    audienceTier: "family",
    withApprovalConsent: true,
    targetFamilyIds: familyIds,
  });
  return story;
}

describe("Explore family-scope filter", () => {
  it("shows only stories targeted to the scoped family", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const boudreaux = await makeFamily(db, "Boudreaux", narrator.id);
    const carney = await makeFamily(db, "Carney", narrator.id);
    for (const p of [narrator, cousin]) {
      await addMembership(db, p.id, boudreaux.id);
      await addMembership(db, p.id, carney.id);
    }
    const inBoudreaux = await sharedStory(narrator.id, [boudreaux.id]);
    const inCarney = await sharedStory(narrator.id, [carney.id]);

    const boudreauxChronicle = await listStoriesForViewer(db, account(cousin.id), {
      familyId: boudreaux.id,
    });
    expect(boudreauxChronicle.map((s) => s.id)).toEqual([inBoudreaux.id]);

    // Unscoped, the cousin sees both.
    const all = await listStoriesForViewer(db, account(cousin.id));
    expect(new Set(all.map((s) => s.id))).toEqual(
      new Set([inBoudreaux.id, inCarney.id]),
    );
  });

  it("does NOT reveal a family the viewer isn't a member of, even for a story they can otherwise see", async () => {
    // The leak guard: a story targeted to BOTH families is visible to a Carney-only cousin via
    // Carney — but scoping to Boudreaux (which the cousin is not in) must return nothing, so the
    // cousin never learns the story is also a Boudreaux story.
    const me = await makePerson(db, "Alex");
    const carneyCousin = await makePerson(db, "Carney cousin");
    const boudreaux = await makeFamily(db, "Boudreaux", me.id);
    const carney = await makeFamily(db, "Carney", me.id);
    await addMembership(db, me.id, boudreaux.id);
    await addMembership(db, me.id, carney.id);
    await addMembership(db, carneyCousin.id, carney.id);

    const wedding = await sharedStory(me.id, [boudreaux.id, carney.id]);

    // Visible unscoped (via Carney) and under the Carney filter...
    expect(
      (await listStoriesForViewer(db, account(carneyCousin.id))).map((s) => s.id),
    ).toEqual([wedding.id]);
    expect(
      (
        await listStoriesForViewer(db, account(carneyCousin.id), {
          familyId: carney.id,
        })
      ).map((s) => s.id),
    ).toEqual([wedding.id]);
    // ...but NOT under the Boudreaux filter (the cousin isn't a Boudreaux member).
    expect(
      await listStoriesForViewer(db, account(carneyCousin.id), {
        familyId: boudreaux.id,
      }),
    ).toEqual([]);
  });

  it("returns nothing for an anonymous viewer scoping to any family", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    await sharedStory(narrator.id, [fam.id]);

    expect(await listStoriesForViewer(db, anon, { familyId: fam.id })).toEqual([]);
  });

  it("a public story targeted to a family appears in that family's chronicle for a member", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    await addMembership(db, cousin.id, fam.id);

    const { story } = await makeStory(db, {
      ownerPersonId: narrator.id,
      state: "shared",
      audienceTier: "public",
      withApprovalConsent: true,
      targetFamilyIds: [fam.id],
    });

    expect(
      (await listStoriesForViewer(db, account(cousin.id), { familyId: fam.id })).map(
        (s) => s.id,
      ),
    ).toEqual([story.id]);
  });

  it("composes owner-scope and family-scope", async () => {
    const narratorA = await makePerson(db, "Eleanor");
    const narratorB = await makePerson(db, "Theo");
    const cousin = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", narratorA.id);
    for (const p of [narratorA, narratorB, cousin]) {
      await addMembership(db, p.id, fam.id);
    }
    const byA = await sharedStory(narratorA.id, [fam.id]);
    await sharedStory(narratorB.id, [fam.id]);

    const onlyA = await listStoriesForViewer(db, account(cousin.id), {
      familyId: fam.id,
      ownerPersonId: narratorA.id,
    });
    expect(onlyA.map((s) => s.id)).toEqual([byA.id]);
  });
});

describe("Explore pagination + order", () => {
  it("paginates with limit/offset over the full visible set without gaps or overlaps", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    await addMembership(db, cousin.id, fam.id);

    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) ids.add((await sharedStory(narrator.id, [fam.id])).id);

    const page1 = await listStoriesForViewer(db, account(cousin.id), { limit: 2, offset: 0 });
    const page2 = await listStoriesForViewer(db, account(cousin.id), { limit: 2, offset: 2 });
    const page3 = await listStoriesForViewer(db, account(cousin.id), { limit: 2, offset: 4 });
    expect([page1, page2, page3].map((p) => p.length)).toEqual([2, 2, 1]);

    const seen = [...page1, ...page2, ...page3].map((s) => s.id);
    expect(new Set(seen)).toEqual(ids); // every story once
    expect(seen.length).toBe(5); // no overlap
  });

  it("orders most-recently-shared first (approvedAt desc)", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    await addMembership(db, cousin.id, fam.id);

    const oldest = await sharedStory(narrator.id, [fam.id]);
    const middle = await sharedStory(narrator.id, [fam.id]);
    const newest = await sharedStory(narrator.id, [fam.id]);
    // Stamp explicit, distinct approval times so ordering is deterministic.
    await db.update(stories).set({ approvedAt: new Date("2020-01-01") }).where(eq(stories.id, oldest.id));
    await db.update(stories).set({ approvedAt: new Date("2021-01-01") }).where(eq(stories.id, middle.id));
    await db.update(stories).set({ approvedAt: new Date("2022-01-01") }).where(eq(stories.id, newest.id));

    const feed = await listStoriesForViewer(db, account(cousin.id), { familyId: fam.id });
    expect(feed.map((s) => s.id)).toEqual([newest.id, middle.id, oldest.id]);
  });
});
