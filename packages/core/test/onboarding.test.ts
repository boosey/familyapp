/**
 * Tests for the onboarding writes that the /welcome flow performs through core.
 *
 * Regression focus: `completeOnboarding` must reject dates the old web-layer validation let through
 * — a non-real calendar date (e.g. Feb 31) and a future date — and must stamp `onboarded_at` (the
 * gate the whole app routes on) only on a valid date. `recordInterviewAnchors` must merge without
 * ever clearing previously-saved anchors.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  InvariantViolation,
  completeOnboarding,
  recordInterviewAnchors,
} from "../src/index";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function makePerson(): Promise<string> {
  const [p] = await db
    .insert(persons)
    .values({ displayName: "Eleanor Boudreaux", spokenName: "Eleanor" })
    .returning();
  return p!.id;
}

async function personRow(personId: string) {
  const [p] = await db
    .select({
      birthDate: persons.birthDate,
      birthYear: persons.birthYear,
      onboardedAt: persons.onboardedAt,
      anchors: persons.biographicalAnchors,
    })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);
  return p!;
}

describe("completeOnboarding", () => {
  it("writes birth_date, birth_year, and stamps onboarded_at for a valid date", async () => {
    const personId = await makePerson();
    const now = new Date("2026-06-28T12:00:00Z");
    await completeOnboarding(db, personId, { year: 1948, month: 3, day: 12, now });

    const row = await personRow(personId);
    expect(row.birthDate).toBe("1948-03-12");
    expect(row.birthYear).toBe(1948);
    expect(row.onboardedAt).not.toBeNull();
  });

  it("rejects a non-real calendar date (Feb 31) and writes nothing — onboarded_at stays null", async () => {
    const personId = await makePerson();
    await expect(
      completeOnboarding(db, personId, { year: 1950, month: 2, day: 31 }),
    ).rejects.toBeInstanceOf(InvariantViolation);
    const row = await personRow(personId);
    expect(row.onboardedAt).toBeNull();
    expect(row.birthDate).toBeNull();
  });

  it("rejects April 31 (a month-specific impossible day)", async () => {
    const personId = await makePerson();
    await expect(
      completeOnboarding(db, personId, { year: 1980, month: 4, day: 31 }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("rejects Feb 29 on a non-leap year but accepts it on a leap year", async () => {
    const personId = await makePerson();
    await expect(
      completeOnboarding(db, personId, { year: 1995, month: 2, day: 29 }),
    ).rejects.toBeInstanceOf(InvariantViolation);
    // 1996 is a leap year — valid.
    await completeOnboarding(db, personId, {
      year: 1996,
      month: 2,
      day: 29,
      now: new Date("2026-06-28T12:00:00Z"),
    });
    expect((await personRow(personId)).birthDate).toBe("1996-02-29");
  });

  it("rejects a future date and writes nothing", async () => {
    const personId = await makePerson();
    const now = new Date("2026-06-28T12:00:00Z");
    await expect(
      completeOnboarding(db, personId, { year: 2027, month: 1, day: 1, now }),
    ).rejects.toBeInstanceOf(InvariantViolation);
    expect((await personRow(personId)).onboardedAt).toBeNull();
  });

  it("accepts a date of birth of today (boundary — not in the future)", async () => {
    const personId = await makePerson();
    const now = new Date("2026-06-28T12:00:00Z");
    await completeOnboarding(db, personId, { year: 2026, month: 6, day: 28, now });
    expect((await personRow(personId)).birthDate).toBe("2026-06-28");
  });

  it("rejects non-integer / out-of-range components", async () => {
    const personId = await makePerson();
    await expect(
      completeOnboarding(db, personId, { year: 1990, month: 13, day: 1 }),
    ).rejects.toBeInstanceOf(InvariantViolation);
    await expect(
      completeOnboarding(db, personId, { year: 1990.5, month: 1, day: 1 }),
    ).rejects.toBeInstanceOf(InvariantViolation);
    await expect(
      completeOnboarding(db, personId, { year: 1990, month: 1, day: 0 }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });
});

describe("recordInterviewAnchors", () => {
  it("adds anchors from the answers", async () => {
    const personId = await makePerson();
    await recordInterviewAnchors(db, personId, {
      birthplace: "Lafayette, Louisiana",
      placesLived: ["New Orleans", "Houston"],
      keyMoments: ["The summer at the coast"],
    });
    expect((await personRow(personId)).anchors).toEqual({
      birthplace: "Lafayette, Louisiana",
      placesLived: ["New Orleans", "Houston"],
      keyMoments: ["The summer at the coast"],
    });
  });

  it("merges across calls without clearing previously-saved anchors (partial-exit safety)", async () => {
    const personId = await makePerson();
    await recordInterviewAnchors(db, personId, { birthplace: "Lafayette" });
    // A later partial save (e.g. user answered one more then exited) must not wipe birthplace.
    await recordInterviewAnchors(db, personId, { keyMoments: ["A wedding"] });
    expect((await personRow(personId)).anchors).toEqual({
      birthplace: "Lafayette",
      keyMoments: ["A wedding"],
    });
  });

  it("trims whitespace and ignores empty/blank entries", async () => {
    const personId = await makePerson();
    await recordInterviewAnchors(db, personId, {
      birthplace: "  Baton Rouge  ",
      placesLived: ["  ", "Mobile", ""],
      keyMoments: ["   "],
    });
    const anchors = (await personRow(personId)).anchors as Record<string, unknown>;
    expect(anchors.birthplace).toBe("Baton Rouge");
    expect(anchors.placesLived).toEqual(["Mobile"]);
    // An all-blank list contributes no key at all.
    expect(anchors.keyMoments).toBeUndefined();
  });
});
