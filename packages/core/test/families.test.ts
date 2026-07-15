/**
 * Tests for family creation + discovery. Creating a family atomically makes the creator both the
 * steward AND an active `steward` member; discovery settings are steward-only.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AuthorizationError,
  InvariantViolation,
  createFamily,
  getFamily,
  isActiveMember,
  listFamiliesStewardedBy,
  listMembersOfFamily,
  setFamilyDiscovery,
  updateFamily,
} from "../src/index";
import { makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

describe("createFamily", () => {
  it("creates the family with creator as steward + active steward membership", async () => {
    const rosa = await makePerson(db, "Rosa Esposito");
    const { familyId, membershipId } = await createFamily(db, {
      name: "Esposito",
      creatorPersonId: rosa.id,
    });
    expect(familyId).toBeTruthy();
    expect(membershipId).toBeTruthy();

    const fam = await getFamily(db, familyId);
    expect(fam?.creatorPersonId).toBe(rosa.id);
    expect(fam?.stewardPersonId).toBe(rosa.id);
    expect(fam?.discoverable).toBe(false);

    expect(await isActiveMember(db, rosa.id, familyId)).toBe(true);
    const members = await listMembersOfFamily(db, familyId);
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe("steward");
    expect(members[0]?.displayName).toBe("Rosa Esposito");
  });

  it("trims the name and rejects an empty one", async () => {
    const p = await makePerson(db, "P");
    await expect(
      createFamily(db, { name: "   ", creatorPersonId: p.id }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("stores description + discoverable when provided", async () => {
    const p = await makePerson(db, "P");
    const { familyId } = await createFamily(db, {
      name: "Bakers",
      description: "Bakers from Naples",
      discoverable: true,
      creatorPersonId: p.id,
    });
    const fam = await getFamily(db, familyId);
    expect(fam?.description).toBe("Bakers from Naples");
    expect(fam?.discoverable).toBe(true);
  });

  it("persists a trimmed shortName (ADR-0021)", async () => {
    const p = await makePerson(db, "P");
    const { familyId } = await createFamily(db, {
      name: "The Boudreaux family",
      shortName: "  Boudreaux  ",
      creatorPersonId: p.id,
    });
    expect((await getFamily(db, familyId))?.shortName).toBe("Boudreaux");
  });

  it("stores null shortName when blank or omitted", async () => {
    const p = await makePerson(db, "P");
    const blank = await createFamily(db, {
      name: "Blank",
      shortName: "   ",
      creatorPersonId: p.id,
    });
    expect((await getFamily(db, blank.familyId))?.shortName).toBeNull();

    const omitted = await createFamily(db, {
      name: "Omitted",
      creatorPersonId: p.id,
    });
    expect((await getFamily(db, omitted.familyId))?.shortName).toBeNull();
  });
});

describe("getFamily", () => {
  it("returns null for an unknown id", async () => {
    expect(
      await getFamily(db, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });
});

describe("setFamilyDiscovery", () => {
  it("lets the steward toggle discovery + edit the description", async () => {
    const rosa = await makePerson(db, "Rosa");
    const { familyId } = await createFamily(db, {
      name: "Esposito",
      creatorPersonId: rosa.id,
    });
    await setFamilyDiscovery(db, {
      familyId,
      actorPersonId: rosa.id,
      discoverable: true,
      description: "Now searchable",
    });
    const fam = await getFamily(db, familyId);
    expect(fam?.discoverable).toBe(true);
    expect(fam?.description).toBe("Now searchable");
  });

  it("rejects a non-steward actor", async () => {
    const rosa = await makePerson(db, "Rosa");
    const stranger = await makePerson(db, "Stranger");
    const { familyId } = await createFamily(db, {
      name: "Esposito",
      creatorPersonId: rosa.id,
    });
    await expect(
      setFamilyDiscovery(db, {
        familyId,
        actorPersonId: stranger.id,
        discoverable: true,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("throws InvariantViolation for an unknown family", async () => {
    const rosa = await makePerson(db, "Rosa");
    await expect(
      setFamilyDiscovery(db, {
        familyId: "00000000-0000-0000-0000-000000000000",
        actorPersonId: rosa.id,
        discoverable: true,
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });
});

describe("updateFamily", () => {
  it("lets the steward update name, shortName, description + discoverable", async () => {
    const rosa = await makePerson(db, "Rosa");
    const { familyId } = await createFamily(db, {
      name: "Esposito",
      creatorPersonId: rosa.id,
    });
    await updateFamily(db, {
      familyId,
      actorPersonId: rosa.id,
      name: "The Esposito family",
      shortName: "Esposito",
      description: "Bakers from Naples",
      discoverable: true,
    });
    const fam = await getFamily(db, familyId);
    expect(fam?.name).toBe("The Esposito family");
    expect(fam?.shortName).toBe("Esposito");
    expect(fam?.description).toBe("Bakers from Naples");
    expect(fam?.discoverable).toBe(true);
  });

  it("clears blank shortName + description to null", async () => {
    const rosa = await makePerson(db, "Rosa");
    const { familyId } = await createFamily(db, {
      name: "Esposito",
      shortName: "Esposito",
      description: "Old blurb",
      creatorPersonId: rosa.id,
    });
    await updateFamily(db, {
      familyId,
      actorPersonId: rosa.id,
      name: "Esposito",
      shortName: "   ",
      description: "   ",
      discoverable: false,
    });
    const fam = await getFamily(db, familyId);
    expect(fam?.shortName).toBeNull();
    expect(fam?.description).toBeNull();
  });

  it("rejects an empty/whitespace name with InvariantViolation", async () => {
    const rosa = await makePerson(db, "Rosa");
    const { familyId } = await createFamily(db, {
      name: "Esposito",
      creatorPersonId: rosa.id,
    });
    await expect(
      updateFamily(db, {
        familyId,
        actorPersonId: rosa.id,
        name: "   ",
        discoverable: false,
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("rejects a non-steward actor and leaves the family unchanged", async () => {
    const rosa = await makePerson(db, "Rosa");
    const stranger = await makePerson(db, "Stranger");
    const { familyId } = await createFamily(db, {
      name: "Esposito",
      description: "Original",
      creatorPersonId: rosa.id,
    });
    await expect(
      updateFamily(db, {
        familyId,
        actorPersonId: stranger.id,
        name: "Hijacked",
        description: "Tampered",
        discoverable: true,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const fam = await getFamily(db, familyId);
    expect(fam?.name).toBe("Esposito");
    expect(fam?.description).toBe("Original");
    expect(fam?.discoverable).toBe(false);
  });

  it("throws InvariantViolation for an unknown family", async () => {
    const rosa = await makePerson(db, "Rosa");
    await expect(
      updateFamily(db, {
        familyId: "00000000-0000-0000-0000-000000000000",
        actorPersonId: rosa.id,
        name: "Ghost",
        discoverable: false,
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });
});

describe("listFamiliesStewardedBy", () => {
  it("returns only the families the person stewards, sorted by name", async () => {
    const rosa = await makePerson(db, "Rosa");
    const bob = await makePerson(db, "Bob");
    const { familyId: rosaZeta } = await createFamily(db, {
      name: "Zeta",
      creatorPersonId: rosa.id,
    });
    const { familyId: rosaAlpha } = await createFamily(db, {
      name: "Alpha",
      shortName: "A",
      creatorPersonId: rosa.id,
    });
    const { familyId: bobFamily } = await createFamily(db, {
      name: "Bakers",
      creatorPersonId: bob.id,
    });

    const rosaFamilies = await listFamiliesStewardedBy(db, rosa.id);
    expect(rosaFamilies.map((f) => f.familyId)).toEqual([rosaAlpha, rosaZeta]);
    expect(rosaFamilies.map((f) => f.name)).toEqual(["Alpha", "Zeta"]);
    expect(rosaFamilies[0]?.shortName).toBe("A");
    expect(rosaFamilies[1]?.shortName).toBeNull();

    const bobFamilies = await listFamiliesStewardedBy(db, bob.id);
    expect(bobFamilies.map((f) => f.familyId)).toEqual([bobFamily]);
  });
});
