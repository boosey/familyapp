/**
 * Tests for the onboarding writes that the /welcome flow performs through core.
 *
 * Regression focus:
 *  - `completeOnboarding` persists the user-entered name (with a derived spokenName) alongside the
 *    DOB in one write, so a Person never crosses the `onboarded_at` gate carrying the email-prefix
 *    placeholder (the reported bug).
 *  - It must reject an empty/whitespace name AND the dates the old web-layer validation let through
 *    (a non-real calendar date like Feb 31, a future date) — and must stamp `onboarded_at` (the gate
 *    the whole app routes on) only when everything is valid.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  InvariantViolation,
  completeOnboarding,
} from "../src/index";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function makePerson(): Promise<string> {
  // Seed with the email-prefix-style placeholder that JIT provisioning leaves behind, so the tests
  // below prove onboarding overwrites it with the real, user-entered name.
  const [p] = await db
    .insert(persons)
    .values({ displayName: "eleanorb", spokenName: "eleanorb" })
    .returning();
  return p!.id;
}

async function personRow(personId: string) {
  const [p] = await db
    .select({
      displayName: persons.displayName,
      spokenName: persons.spokenName,
      birthDate: persons.birthDate,
      birthYear: persons.birthYear,
      onboardedAt: persons.onboardedAt,
    })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);
  return p!;
}

describe("completeOnboarding", () => {
  it("persists displayName + derived spokenName + DOB and stamps onboarded_at in one call", async () => {
    const personId = await makePerson();
    const now = new Date("2026-06-28T12:00:00Z");
    await completeOnboarding(db, personId, {
      displayName: "Alex Boudreaux",
      year: 1948,
      month: 3,
      day: 12,
      now,
    });

    const row = await personRow(personId);
    expect(row.displayName).toBe("Alex Boudreaux");
    // spokenName re-derived from the entered name (first whitespace-delimited word).
    expect(row.spokenName).toBe("Alex");
    expect(row.birthDate).toBe("1948-03-12");
    expect(row.birthYear).toBe(1948);
    expect(row.onboardedAt).not.toBeNull();
  });

  it("trims the display name and derives spokenName from the trimmed value", async () => {
    const personId = await makePerson();
    await completeOnboarding(db, personId, {
      displayName: "  Rosa Maria Chen  ",
      year: 1960,
      month: 1,
      day: 1,
      now: new Date("2026-06-28T12:00:00Z"),
    });
    const row = await personRow(personId);
    expect(row.displayName).toBe("Rosa Maria Chen");
    expect(row.spokenName).toBe("Rosa");
  });

  it("rejects an empty display name and writes nothing — onboarded_at stays null", async () => {
    const personId = await makePerson();
    await expect(
      completeOnboarding(db, personId, {
        displayName: "",
        year: 1948,
        month: 3,
        day: 12,
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
    const row = await personRow(personId);
    expect(row.onboardedAt).toBeNull();
    expect(row.birthDate).toBeNull();
    // The placeholder name is untouched — the reject happened before any write.
    expect(row.displayName).toBe("eleanorb");
  });

  it("rejects a whitespace-only display name and writes nothing", async () => {
    const personId = await makePerson();
    await expect(
      completeOnboarding(db, personId, {
        displayName: "   ",
        year: 1948,
        month: 3,
        day: 12,
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
    expect((await personRow(personId)).onboardedAt).toBeNull();
  });

  it("rejects a non-real calendar date (Feb 31) and writes nothing — onboarded_at stays null", async () => {
    const personId = await makePerson();
    await expect(
      completeOnboarding(db, personId, {
        displayName: "Alex Boudreaux",
        year: 1950,
        month: 2,
        day: 31,
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
    const row = await personRow(personId);
    expect(row.onboardedAt).toBeNull();
    expect(row.birthDate).toBeNull();
    // A valid name with a bad date must not sneak a name write past the failed validation.
    expect(row.displayName).toBe("eleanorb");
  });

  it("rejects April 31 (a month-specific impossible day)", async () => {
    const personId = await makePerson();
    await expect(
      completeOnboarding(db, personId, {
        displayName: "Alex Boudreaux",
        year: 1980,
        month: 4,
        day: 31,
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("rejects Feb 29 on a non-leap year but accepts it on a leap year", async () => {
    const personId = await makePerson();
    await expect(
      completeOnboarding(db, personId, {
        displayName: "Alex Boudreaux",
        year: 1995,
        month: 2,
        day: 29,
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
    // 1996 is a leap year — valid.
    await completeOnboarding(db, personId, {
      displayName: "Alex Boudreaux",
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
      completeOnboarding(db, personId, {
        displayName: "Alex Boudreaux",
        year: 2027,
        month: 1,
        day: 1,
        now,
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
    expect((await personRow(personId)).onboardedAt).toBeNull();
  });

  it("accepts a date of birth of today (boundary — not in the future)", async () => {
    const personId = await makePerson();
    const now = new Date("2026-06-28T12:00:00Z");
    await completeOnboarding(db, personId, {
      displayName: "Alex Boudreaux",
      year: 2026,
      month: 6,
      day: 28,
      now,
    });
    expect((await personRow(personId)).birthDate).toBe("2026-06-28");
  });

  it("rejects non-integer / out-of-range components", async () => {
    const personId = await makePerson();
    await expect(
      completeOnboarding(db, personId, {
        displayName: "Alex Boudreaux",
        year: 1990,
        month: 13,
        day: 1,
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
    await expect(
      completeOnboarding(db, personId, {
        displayName: "Alex Boudreaux",
        year: 1990.5,
        month: 1,
        day: 1,
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
    await expect(
      completeOnboarding(db, personId, {
        displayName: "Alex Boudreaux",
        year: 1990,
        month: 1,
        day: 0,
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });
});
