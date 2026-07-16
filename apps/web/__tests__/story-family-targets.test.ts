/**
 * `loadStoryFamilyTargets` must intersect a story's target families (`story_families`, ADR-0010)
 * with the viewer's own active families — a story card must never name a family the viewer isn't
 * in, and the returned set must match exactly which scopes the family-scope filter can select.
 */
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@chronicle/db";
import { families, storyFamilies } from "@chronicle/db/schema";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { listStoriesForViewer } from "@chronicle/core";
import type { AuthContext } from "@chronicle/core";
import { seedInto } from "../lib/dev-seed";
import { loadStoryFamilyTargets } from "../lib/hub-data";

async function fixture() {
  const db = await createTestDatabase();
  const result = await seedInto(db, new InMemoryMediaStorage());
  const narrator = result.narratorPersonId!;
  const boudreaux = result.boudreauxFamilyId!;
  const ctx: AuthContext = { kind: "account", personId: narrator };

  // One of the narrator's own stories, fetched through the front door.
  const stories = await listStoriesForViewer(db, ctx, { ownerPersonId: narrator });
  const storyId = stories[0]!.id;

  // A SECOND family the same story is also targeted to — but the viewer is NOT a member of it.
  const [carney] = await db
    .insert(families)
    .values({
      name: "Carney",
      shortName: "Carneys",
      creatorPersonId: narrator,
      stewardPersonId: narrator,
    })
    .returning();
  await db
    .insert(storyFamilies)
    .values([
      { storyId, familyId: boudreaux },
      { storyId, familyId: carney!.id },
    ])
    .onConflictDoNothing();

  return { db, storyId, boudreaux, carney: carney!.id };
}

describe("loadStoryFamilyTargets — intersects targets with the viewer's families", () => {
  it("drops a target family the viewer is not a member of", async () => {
    const { db, storyId, boudreaux } = await fixture();
    const map = await loadStoryFamilyTargets(db, [storyId], [boudreaux]);
    expect(map.get(storyId)?.map((f) => f.id)).toEqual([boudreaux]);
  });

  it("returns every target family the viewer shares", async () => {
    const { db, storyId, boudreaux, carney } = await fixture();
    const map = await loadStoryFamilyTargets(db, [storyId], [boudreaux, carney]);
    const ids = (map.get(storyId) ?? []).map((f) => f.id).sort();
    expect(ids).toEqual([boudreaux, carney].sort());
  });

  it("carries each family's steward-set short name through for the tag label (ADR-0021)", async () => {
    const { db, storyId, boudreaux, carney } = await fixture();
    const map = await loadStoryFamilyTargets(db, [storyId], [boudreaux, carney]);
    const carneyRef = (map.get(storyId) ?? []).find((f) => f.id === carney);
    expect(carneyRef?.shortName).toBe("Carneys");
  });

  it("returns an empty map for degenerate inputs (no story ids / no viewer families)", async () => {
    const { db, storyId, boudreaux } = await fixture();
    expect((await loadStoryFamilyTargets(db, [], [boudreaux])).size).toBe(0);
    expect((await loadStoryFamilyTargets(db, [storyId], [])).size).toBe(0);
  });
});
