/**
 * Server-side integration test for `loadTagSuggestionsAction` (unified tags/photos, Task 2).
 *
 * The action is the read-only typeahead loader for the unified tag field: it returns the caller's
 * active families and the target story's existing freeform tags. This suite seeds an account person
 * with an active family membership and a story they own carrying tags, then asserts the loader
 * surfaces both through the front door.
 *
 * Harness mirrors `share-family-picker.server.test.ts`: `@/lib/runtime` is mocked so importing the
 * actions module doesn't boot the real DEV runtime; getRuntime() reads settable module-level bindings.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let runtimeDb: Database;
let authCtx: { kind: string; personId?: string };

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    auth: { getCurrentAuthContext: async () => authCtx },
  }),
}));

import { createTestDatabase, type Database } from "@chronicle/db";
import { persons, families, memberships } from "@chronicle/db/schema";
import { createTextDraft, updateDerivedFields } from "@chronicle/core";
import { loadTagSuggestionsAction } from "../app/hub/tag-suggestions-actions";

async function makePerson(db: Database, name = "Eleanor"): Promise<string> {
  const [p] = await db.insert(persons).values({ displayName: name, spokenName: name }).returning();
  return p!.id;
}

async function makeFamilyWithMember(db: Database, name: string, personId: string): Promise<string> {
  const [f] = await db
    .insert(families)
    .values({ name, creatorPersonId: personId, stewardPersonId: personId })
    .returning();
  await db.insert(memberships).values({ personId, familyId: f!.id, status: "active" });
  return f!.id;
}

async function seedStoryWithTags(personId: string, tags: string[]): Promise<string> {
  const { story } = await createTextDraft(runtimeDb, {
    ownerPersonId: personId,
    text: "The summer we drove to the coast and the car broke down.",
  });
  await updateDerivedFields(runtimeDb, story.id, { tags });
  return story.id;
}

describe("loadTagSuggestionsAction — typeahead data for the unified tag field", () => {
  beforeEach(async () => {
    runtimeDb = await createTestDatabase();
    authCtx = { kind: "none" };
  });

  it("returns the owner's active families and the story's existing tags", async () => {
    const personId = await makePerson(runtimeDb, "Eleanor");
    authCtx = { kind: "account", personId };
    const famId = await makeFamilyWithMember(runtimeDb, "Boudreaux", personId);
    const storyId = await seedStoryWithTags(personId, ["childhood", "coast"]);

    const res = await loadTagSuggestionsAction(storyId);

    expect("error" in res).toBe(false);
    if ("error" in res) throw new Error("unexpected error result");
    expect(res.families.map((f) => f.id)).toContain(famId);
    expect(res.tags).toContain("childhood");
    expect(res.tags).toContain("coast");
  });
});
