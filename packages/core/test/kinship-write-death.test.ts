/**
 * Regression tests for create-time death-year capture (ADR-0016 tree renderer, spec §4).
 *
 * `addRelative` must persist `deathYear`/`deathDate` onto the created relative Person when it is
 * `deceased`, and leave both NULL for a `living` relative (defensive: a stray death year on a living
 * node must never persist). Reads the raw `persons` row directly — this is a write-path test, not a
 * content read through the story front door.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addMembership, addRelative } from "../src/index";
import { makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string) => ({ kind: "account", personId }) as const;

async function familyWithMember(memberName = "Me") {
  const member = await makePerson(db, memberName);
  const fam = await makeFamily(db, "Esposito", member.id);
  await addMembership(db, { personId: member.id, familyId: fam.id, role: "member" });
  return { member, fam };
}

async function personRow(id: string) {
  const [row] = await db
    .select({
      lifeStatus: persons.lifeStatus,
      deathYear: persons.deathYear,
      deathDate: persons.deathDate,
    })
    .from(persons)
    .where(eq(persons.id, id))
    .limit(1);
  return row!;
}

describe("addRelative — death-year capture (spec §4)", () => {
  it("persists deathYear on a deceased relative", async () => {
    const { member, fam } = await familyWithMember();
    const res = await addRelative(db, account(member.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Eleanor Vance",
      lifeStatus: "deceased",
      deathYear: 1998,
    });
    expect(res.allowed).toBe(true);

    const row = await personRow(res.createdPersonId!);
    expect(row.lifeStatus).toBe("deceased");
    expect(row.deathYear).toBe(1998);
  });

  it("persists both deathYear and deathDate on a deceased relative", async () => {
    const { member, fam } = await familyWithMember();
    const res = await addRelative(db, account(member.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Eleanor Vance",
      lifeStatus: "deceased",
      deathYear: 1998,
      deathDate: "1998-04-12",
    });

    const row = await personRow(res.createdPersonId!);
    expect(row.deathYear).toBe(1998);
    expect(row.deathDate).toBe("1998-04-12");
  });

  it("leaves deathYear/deathDate NULL for a living relative even if supplied", async () => {
    const { member, fam } = await familyWithMember();
    const res = await addRelative(db, account(member.id), {
      familyId: fam.id,
      relation: "child",
      displayName: "Sam Vance",
      lifeStatus: "living",
      // Defensive: a stray death year on a living relative must be dropped.
      deathYear: 2020,
      deathDate: "2020-01-01",
    });

    const row = await personRow(res.createdPersonId!);
    expect(row.lifeStatus).toBe("living");
    expect(row.deathYear).toBeNull();
    expect(row.deathDate).toBeNull();
  });

  it("defaults deathYear/deathDate to NULL for a deceased relative with no death fields", async () => {
    const { member, fam } = await familyWithMember();
    const res = await addRelative(db, account(member.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Unknown Forebear",
      lifeStatus: "deceased",
    });

    const row = await personRow(res.createdPersonId!);
    expect(row.lifeStatus).toBe("deceased");
    expect(row.deathYear).toBeNull();
    expect(row.deathDate).toBeNull();
  });
});
