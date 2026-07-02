/**
 * ADR-0010 default family targeting.
 *
 * The Mode 4 read seam narrows family/branch visibility to stories explicitly targeted into a
 * family (`story_families`). This suite guards the WRITE side that keeps the hub from going dark:
 *   - `approveAndShareStory` DEFAULT-targets a family/branch story at approval, using the
 *     originating context when known and a single-family safety fallback otherwise — but NEVER
 *     "all owner families" for a multi-family narrator (that is the Boudreaux/Carney leak the ADR
 *     exists to prevent).
 *   - `computeDefaultFamilyTargets` is the shared, pure rule the approval path applies.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { asks } from "@chronicle/db/schema";
import { beforeEach, describe, expect, it } from "vitest";
import {
  approveAndShareStory,
  computeDefaultFamilyTargets,
  getStoryForViewer,
} from "../src/index";
import {
  addMembership,
  makeFamily,
  makePerson,
  makeStory,
  targetStoryToFamily,
} from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string) => ({ kind: "account" as const, personId });

describe("computeDefaultFamilyTargets (the shared rule)", () => {
  const F1 = "11111111-1111-1111-1111-111111111111";
  const F2 = "22222222-2222-2222-2222-222222222222";

  it("prefers the originating family when the owner is still active in it", () => {
    expect(
      computeDefaultFamilyTargets({
        originatingFamilyId: F1,
        askFamilyId: null,
        ownerActiveFamilyIds: new Set([F1, F2]),
      }),
    ).toEqual({ targets: [F1], ambiguous: false });
  });

  it("ignores an originating family the owner is no longer active in, then falls back", () => {
    // Owner left F1; only active in F2 (single) ⇒ fall back to the single family.
    expect(
      computeDefaultFamilyTargets({
        originatingFamilyId: F1,
        askFamilyId: null,
        ownerActiveFamilyIds: new Set([F2]),
      }),
    ).toEqual({ targets: [F2], ambiguous: false });
  });

  it("uses the ask's family as a secondary signal", () => {
    expect(
      computeDefaultFamilyTargets({
        originatingFamilyId: null,
        askFamilyId: F2,
        ownerActiveFamilyIds: new Set([F1, F2]),
      }),
    ).toEqual({ targets: [F2], ambiguous: false });
  });

  it("dedupes when the originating and ask families coincide", () => {
    expect(
      computeDefaultFamilyTargets({
        originatingFamilyId: F1,
        askFamilyId: F1,
        ownerActiveFamilyIds: new Set([F1]),
      }),
    ).toEqual({ targets: [F1], ambiguous: false });
  });

  it("falls back to the sole active family when there is no signal", () => {
    expect(
      computeDefaultFamilyTargets({
        originatingFamilyId: null,
        askFamilyId: null,
        ownerActiveFamilyIds: new Set([F1]),
      }),
    ).toEqual({ targets: [F1], ambiguous: false });
  });

  it("is AMBIGUOUS (targets nothing) for a multi-family owner with no signal — never 'all families'", () => {
    expect(
      computeDefaultFamilyTargets({
        originatingFamilyId: null,
        askFamilyId: null,
        ownerActiveFamilyIds: new Set([F1, F2]),
      }),
    ).toEqual({ targets: [], ambiguous: true });
  });

  it("targets nothing (NOT ambiguous) when the owner is in no active family", () => {
    expect(
      computeDefaultFamilyTargets({
        originatingFamilyId: null,
        askFamilyId: null,
        ownerActiveFamilyIds: new Set(),
      }),
    ).toEqual({ targets: [], ambiguous: false });
  });
});

describe("approveAndShareStory — default family targeting", () => {
  it("single-family narrator, no signal: auto-targets the one family so a co-member sees it", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    await addMembership(db, cousin.id, fam.id);

    const { story } = await makeStory(db, {
      ownerPersonId: narrator.id,
      state: "pending_approval",
    });
    const result = await approveAndShareStory(db, {
      storyId: story.id,
      narratorPersonId: narrator.id,
      audienceTier: "family",
    });

    expect(result.targetedFamilyIds).toEqual([fam.id]);
    expect(result.ambiguousDefaultTarget).toBe(false);
    expect((await getStoryForViewer(db, account(cousin.id), story.id))?.id).toBe(story.id);
  });

  it("multi-family narrator with an originating family: targets ONLY that family (no cross-family leak)", async () => {
    // Boudreaux/Carney: the narrator (me) and cousin are in both, but a Carney-only cousin must
    // NOT see a story captured for Boudreaux.
    const me = await makePerson(db, "Alex");
    const boudreauxCousin = await makePerson(db, "Boudreaux cousin");
    const carneyOnlyCousin = await makePerson(db, "Carney cousin");
    const boudreaux = await makeFamily(db, "Boudreaux", me.id);
    const carney = await makeFamily(db, "Carney", me.id);
    await addMembership(db, me.id, boudreaux.id);
    await addMembership(db, me.id, carney.id);
    await addMembership(db, boudreauxCousin.id, boudreaux.id);
    await addMembership(db, carneyOnlyCousin.id, carney.id);

    const { story } = await makeStory(db, {
      ownerPersonId: me.id,
      state: "pending_approval",
      originatingFamilyId: boudreaux.id,
    });
    const result = await approveAndShareStory(db, {
      storyId: story.id,
      narratorPersonId: me.id,
      audienceTier: "family",
    });

    expect(result.targetedFamilyIds).toEqual([boudreaux.id]);
    expect(result.ambiguousDefaultTarget).toBe(false);
    expect((await getStoryForViewer(db, account(boudreauxCousin.id), story.id))?.id).toBe(story.id);
    expect(await getStoryForViewer(db, account(carneyOnlyCousin.id), story.id)).toBeNull();
  });

  it("multi-family narrator, NO signal: leaves the story owner-only and flags ambiguity", async () => {
    const me = await makePerson(db, "Alex");
    const boudreauxCousin = await makePerson(db, "Boudreaux cousin");
    const carneyCousin = await makePerson(db, "Carney cousin");
    const boudreaux = await makeFamily(db, "Boudreaux", me.id);
    const carney = await makeFamily(db, "Carney", me.id);
    await addMembership(db, me.id, boudreaux.id);
    await addMembership(db, me.id, carney.id);
    await addMembership(db, boudreauxCousin.id, boudreaux.id);
    await addMembership(db, carneyCousin.id, carney.id);

    const { story } = await makeStory(db, {
      ownerPersonId: me.id,
      state: "pending_approval",
    });
    const result = await approveAndShareStory(db, {
      storyId: story.id,
      narratorPersonId: me.id,
      audienceTier: "family",
    });

    expect(result.targetedFamilyIds).toEqual([]);
    expect(result.ambiguousDefaultTarget).toBe(true);
    // Owner-only: neither cousin sees it, but the owner does.
    expect(await getStoryForViewer(db, account(boudreauxCousin.id), story.id)).toBeNull();
    expect(await getStoryForViewer(db, account(carneyCousin.id), story.id)).toBeNull();
    expect((await getStoryForViewer(db, account(me.id), story.id))?.id).toBe(story.id);
  });

  it("does NOT clobber an explicit target set chosen before approval", async () => {
    const me = await makePerson(db, "Alex");
    const boudreaux = await makeFamily(db, "Boudreaux", me.id);
    const carney = await makeFamily(db, "Carney", me.id);
    await addMembership(db, me.id, boudreaux.id);
    await addMembership(db, me.id, carney.id);

    const { story } = await makeStory(db, {
      ownerPersonId: me.id,
      state: "pending_approval",
      // Even though an originating family exists, an explicit pre-approval choice must win.
      originatingFamilyId: boudreaux.id,
    });
    await targetStoryToFamily(db, story.id, carney.id);

    const result = await approveAndShareStory(db, {
      storyId: story.id,
      narratorPersonId: me.id,
      audienceTier: "family",
    });
    expect(result.targetedFamilyIds).toEqual([carney.id]);
    expect(result.ambiguousDefaultTarget).toBe(false);
  });

  it("public tier is not targeted (no story_families rows needed)", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);

    const { story } = await makeStory(db, {
      ownerPersonId: narrator.id,
      state: "pending_approval",
    });
    const result = await approveAndShareStory(db, {
      storyId: story.id,
      narratorPersonId: narrator.id,
      audienceTier: "public",
    });
    expect(result.targetedFamilyIds).toEqual([]);
    expect(result.ambiguousDefaultTarget).toBe(false);
  });

  it("uses the ask's family when the story has no originating family", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const asker = await makePerson(db, "Sofia");
    const boudreaux = await makeFamily(db, "Boudreaux", narrator.id);
    const carney = await makeFamily(db, "Carney", narrator.id);
    await addMembership(db, narrator.id, boudreaux.id);
    await addMembership(db, narrator.id, carney.id);
    await addMembership(db, asker.id, carney.id);

    // An ask raised in the Carney family context.
    const [ask] = await db
      .insert(asks)
      .values({
        askerPersonId: asker.id,
        targetPersonId: narrator.id,
        familyId: carney.id,
        questionText: "Tell me about the wedding",
        status: "routed",
      })
      .returning();

    const { story } = await makeStory(db, {
      ownerPersonId: narrator.id,
      state: "pending_approval",
      askId: ask!.id,
    });
    const result = await approveAndShareStory(db, {
      storyId: story.id,
      narratorPersonId: narrator.id,
      audienceTier: "family",
    });
    expect(result.targetedFamilyIds).toEqual([carney.id]);
    // The asker (Carney member) sees it.
    expect((await getStoryForViewer(db, account(asker.id), story.id))?.id).toBe(story.id);
  });
});
