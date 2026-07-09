/**
 * Post-onboarding identity field updates (Profile editor).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  InvariantViolation,
  updatePersonDisplayName,
  updatePersonSpokenName,
  updatePersonBirthDate,
  updatePersonIdentity,
} from "../src/index";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function makeOnboardedPerson(): Promise<string> {
  const [p] = await db
    .insert(persons)
    .values({
      displayName: "Eleanor Boudreaux",
      spokenName: "Eleanor",
      birthDate: "1948-03-12",
      birthYear: 1948,
      onboardedAt: new Date("2026-01-01"),
    })
    .returning();
  return p!.id;
}

describe("updatePersonDisplayName", () => {
  it("updates displayName without touching spokenName", async () => {
    const id = await makeOnboardedPerson();
    await updatePersonDisplayName(db, id, "  Rosa Chen  ");
    const [row] = await db.select().from(persons).where(eq(persons.id, id));
    expect(row!.displayName).toBe("Rosa Chen");
    expect(row!.spokenName).toBe("Eleanor");
  });

  it("rejects empty displayName", async () => {
    const id = await makeOnboardedPerson();
    await expect(updatePersonDisplayName(db, id, "  ")).rejects.toBeInstanceOf(
      InvariantViolation,
    );
  });
});

describe("updatePersonSpokenName", () => {
  it("updates spokenName independently", async () => {
    const id = await makeOnboardedPerson();
    await updatePersonSpokenName(db, id, "Ellie");
    expect(
      (await db.select().from(persons).where(eq(persons.id, id)))[0]!.spokenName,
    ).toBe("Ellie");
  });
});

describe("updatePersonBirthDate", () => {
  it("updates birthDate and birthYear", async () => {
    const id = await makeOnboardedPerson();
    await updatePersonBirthDate(db, id, {
      year: 1952,
      month: 7,
      day: 4,
      now: new Date("2026-06-28"),
    });
    const [row] = await db.select().from(persons).where(eq(persons.id, id));
    expect(row!.birthDate).toBe("1952-07-04");
    expect(row!.birthYear).toBe(1952);
  });
});

describe("updatePersonIdentity", () => {
  it("updates all identity fields in one call", async () => {
    const id = await makeOnboardedPerson();
    await updatePersonIdentity(db, id, {
      displayName: "Alex Boudreaux",
      spokenName: "Alex",
      year: 1940,
      month: 1,
      day: 15,
      now: new Date("2026-06-28"),
    });
    const [row] = await db.select().from(persons).where(eq(persons.id, id));
    expect(row!.displayName).toBe("Alex Boudreaux");
    expect(row!.spokenName).toBe("Alex");
    expect(row!.birthDate).toBe("1940-01-15");
    expect(row!.onboardedAt).not.toBeNull();
  });
});
