/**
 * Tests for the discovery search seam. The load-bearing privacy properties: it searches ONLY
 * discoverable families, matches member names as a SIGNAL but NEVER returns them, and ranks
 * name > steward > description > member deterministically.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addMembership,
  createFamily,
  createKeywordFamilySearch,
  listDiscoverableFamilies,
} from "../src/index";
import { makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

describe("createKeywordFamilySearch", () => {
  it("matches on family name", async () => {
    const steward = await makePerson(db, "Rosa");
    await createFamily(db, {
      name: "Esposito",
      discoverable: true,
      creatorPersonId: steward.id,
    });
    const results = await createKeywordFamilySearch(db).search({
      text: "esposito",
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.familyName).toBe("Esposito");
    expect(results[0]?.stewardName).toBe("Rosa");
    expect(results[0]?.matchReason).toBe("name");
  });

  it("never returns a non-discoverable family", async () => {
    const steward = await makePerson(db, "Rosa");
    await createFamily(db, {
      name: "Esposito",
      discoverable: false,
      creatorPersonId: steward.id,
    });
    const results = await createKeywordFamilySearch(db).search({
      text: "esposito",
    });
    expect(results).toHaveLength(0);
  });

  it("matches on steward name + description", async () => {
    const steward = await makePerson(db, "Rosa Esposito");
    await createFamily(db, {
      name: "The Bakers",
      description: "Bakers from Naples for three generations",
      discoverable: true,
      creatorPersonId: steward.id,
    });
    const bySteward = await createKeywordFamilySearch(db).search({
      text: "rosa",
    });
    expect(bySteward[0]?.familyName).toBe("The Bakers");
    expect(bySteward[0]?.matchReason).toContain("steward");

    const byDesc = await createKeywordFamilySearch(db).search({
      text: "naples",
    });
    expect(byDesc[0]?.familyName).toBe("The Bakers");
    expect(byDesc[0]?.matchReason).toBe("description");
  });

  it("matches a member name as a signal but NEVER leaks member names", async () => {
    const steward = await makePerson(db, "Rosa");
    const { familyId } = await createFamily(db, {
      name: "The Bakers",
      discoverable: true,
      creatorPersonId: steward.id,
    });
    const member = await makePerson(db, "Salvatore Verdi");
    await addMembership(db, { personId: member.id, familyId });

    const results = await createKeywordFamilySearch(db).search({
      text: "salvatore",
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.matchReason).toBe("member match");
    // The member's name must NOT appear anywhere in the result payload.
    expect(JSON.stringify(results)).not.toContain("Salvatore");
    expect(JSON.stringify(results)).not.toContain("Verdi");
  });

  it("ranks a name hit above a member hit and respects the limit", async () => {
    const s1 = await makePerson(db, "Steward One");
    const s2 = await makePerson(db, "Steward Two");
    // Family A: name contains the query token.
    await createFamily(db, {
      name: "Napoli",
      discoverable: true,
      creatorPersonId: s1.id,
    });
    // Family B: only a member's name contains the token.
    const { familyId: bId } = await createFamily(db, {
      name: "Other",
      discoverable: true,
      creatorPersonId: s2.id,
    });
    const member = await makePerson(db, "Napoli Fan");
    await addMembership(db, { personId: member.id, familyId: bId });

    const ranked = await createKeywordFamilySearch(db).search({
      text: "napoli",
    });
    expect(ranked.map((r) => r.familyName)).toEqual(["Napoli", "Other"]);

    const limited = await createKeywordFamilySearch(db).search({
      text: "napoli",
      limit: 1,
    });
    expect(limited.map((r) => r.familyName)).toEqual(["Napoli"]);
  });

  it("returns nothing for an empty query", async () => {
    const steward = await makePerson(db, "Rosa");
    await createFamily(db, {
      name: "Esposito",
      discoverable: true,
      creatorPersonId: steward.id,
    });
    expect(
      await createKeywordFamilySearch(db).search({ text: "   " }),
    ).toHaveLength(0);
  });
});

describe("listDiscoverableFamilies", () => {
  it("lists discoverable families (name + steward only), sorted by name", async () => {
    const s1 = await makePerson(db, "Rosa Esposito");
    const s2 = await makePerson(db, "Ada Byron");
    await createFamily(db, { name: "Zappa", discoverable: true, creatorPersonId: s1.id });
    await createFamily(db, { name: "Abbott", discoverable: true, creatorPersonId: s2.id });

    const list = await listDiscoverableFamilies(db);
    expect(list.map((f) => f.familyName)).toEqual(["Abbott", "Zappa"]);
    expect(list[0]?.stewardName).toBe("Ada Byron");
    // Name + steward only — the shape carries no member/story fields.
    expect(Object.keys(list[0] ?? {}).sort()).toEqual(
      ["familyId", "familyName", "stewardName"].sort(),
    );
  });

  it("excludes non-discoverable families", async () => {
    const steward = await makePerson(db, "Rosa");
    await createFamily(db, { name: "Private", discoverable: false, creatorPersonId: steward.id });
    await createFamily(db, { name: "Open", discoverable: true, creatorPersonId: steward.id });

    const list = await listDiscoverableFamilies(db);
    expect(list.map((f) => f.familyName)).toEqual(["Open"]);
  });

  it("never leaks member names into the browse list", async () => {
    const steward = await makePerson(db, "Rosa");
    const { familyId } = await createFamily(db, {
      name: "The Bakers",
      discoverable: true,
      creatorPersonId: steward.id,
    });
    const member = await makePerson(db, "Salvatore Verdi");
    await addMembership(db, { personId: member.id, familyId });

    const list = await listDiscoverableFamilies(db);
    expect(JSON.stringify(list)).not.toContain("Salvatore");
    expect(JSON.stringify(list)).not.toContain("Verdi");
  });

  it("respects the limit", async () => {
    const steward = await makePerson(db, "Rosa");
    await createFamily(db, { name: "Alpha", discoverable: true, creatorPersonId: steward.id });
    await createFamily(db, { name: "Beta", discoverable: true, creatorPersonId: steward.id });
    const list = await listDiscoverableFamilies(db, { limit: 1 });
    expect(list).toHaveLength(1);
    expect(list[0]?.familyName).toBe("Alpha");
  });
});
