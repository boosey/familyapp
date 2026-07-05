/**
 * Increment 4B, Task 4.4 — the Ask compose surface seeds its family target set from the hub scope.
 *
 * Two layers are pinned here:
 *   1. The pure resolver/seed helpers (lib/compose-scope) — the rule the server action + the UI share.
 *   2. An end-to-end createAsk assertion via the `ask_families` join table: composing with
 *      scope=familyA writes exactly one ask_families row for A; composing in "all" with two families
 *      and NO selection is rejected before any ask is written.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { askFamilies, families, memberships, persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createAsk } from "@chronicle/core";
import {
  familyChoiceRequired,
  resolveComposeFamilies,
  seedComposeFamilies,
} from "../lib/compose-scope";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function makePerson(name: string): Promise<string> {
  const [p] = await db
    .insert(persons)
    .values({ displayName: name, spokenName: name })
    .returning();
  return p!.id;
}
async function makeFamily(name: string, creatorId: string): Promise<string> {
  const [f] = await db
    .insert(families)
    .values({ name, creatorPersonId: creatorId, stewardPersonId: creatorId })
    .returning();
  return f!.id;
}
async function addMembership(personId: string, familyId: string): Promise<void> {
  await db.insert(memberships).values({ personId, familyId, status: "active" });
}

describe("compose-scope seeding (pure)", () => {
  it("pre-checks the scoped family when scope is a family id", () => {
    expect(seedComposeFamilies("famA", ["famA", "famB"])).toEqual(new Set(["famA"]));
  });
  it("auto-seeds the lone family in 'all' with exactly one family", () => {
    expect(seedComposeFamilies("all", ["famOnly"])).toEqual(new Set(["famOnly"]));
  });
  it("pre-checks nothing in 'all' with several families", () => {
    expect(seedComposeFamilies("all", ["famA", "famB"])).toEqual(new Set());
  });
  it("ignores a scope that is not one of the viewer's families", () => {
    expect(seedComposeFamilies("stranger", ["famA"])).toEqual(new Set());
  });
});

describe("familyChoiceRequired", () => {
  it("requires a choice only in 'all' with several families", () => {
    expect(familyChoiceRequired("all", ["famA", "famB"])).toBe(true);
    expect(familyChoiceRequired("all", ["famA"])).toBe(false);
    expect(familyChoiceRequired("famA", ["famA", "famB"])).toBe(false);
  });
});

describe("resolveComposeFamilies", () => {
  it("returns the valid chosen ids (deduped)", () => {
    expect(resolveComposeFamilies(["famA", "famA"], ["famA", "famB"])).toEqual(["famA"]);
  });
  it("auto-resolves the lone family when nothing chosen", () => {
    expect(resolveComposeFamilies([], ["famOnly"])).toEqual(["famOnly"]);
  });
  it("drops chosen ids the viewer is not actually in", () => {
    expect(resolveComposeFamilies(["stranger", "famA"], ["famA"])).toEqual(["famA"]);
  });
  it("throws when nothing chosen and the asker has >1 family", () => {
    expect(() => resolveComposeFamilies([], ["famA", "famB"])).toThrow();
  });
  it("returns [] for a familyless (pending-only) asker", () => {
    expect(resolveComposeFamilies([], [])).toEqual([]);
  });
});

describe("createAsk via resolved compose scope (join table)", () => {
  it("scope=familyA writes exactly one ask_families row for A", async () => {
    const narrator = await makePerson("Eleanor");
    const cousin = await makePerson("Sofia");
    const famA = await makeFamily("A", narrator);
    const famB = await makeFamily("B", narrator);
    for (const fam of [famA, famB]) {
      await addMembership(narrator, fam);
      await addMembership(cousin, fam);
    }

    // Hub scope is famA → seed → resolve → these are the ids the server action passes to createAsk.
    const seeded = [...seedComposeFamilies(famA, [famA, famB])];
    const familyIds = resolveComposeFamilies(seeded, [famA, famB]);
    expect(familyIds).toEqual([famA]);

    const ask = await createAsk(
      db,
      { kind: "account", personId: cousin },
      { targetPersonId: narrator, questionText: "What was Sunday like?", familyIds },
    );

    const rows = await db
      .select({ familyId: askFamilies.familyId })
      .from(askFamilies)
      .where(eq(askFamilies.askId, ask.id));
    expect(rows.map((r) => r.familyId)).toEqual([famA]);
  });

  it("'all' + two families + no selection is rejected before any ask is written", async () => {
    const narrator = await makePerson("Eleanor");
    const cousin = await makePerson("Sofia");
    const famA = await makeFamily("A", narrator);
    const famB = await makeFamily("B", narrator);
    for (const fam of [famA, famB]) {
      await addMembership(narrator, fam);
      await addMembership(cousin, fam);
    }

    const seeded = [...seedComposeFamilies("all", [famA, famB])];
    expect(seeded).toEqual([]);
    // The server-side guard fires here — createAsk is never reached.
    expect(() => resolveComposeFamilies(seeded, [famA, famB])).toThrow();
  });
});
