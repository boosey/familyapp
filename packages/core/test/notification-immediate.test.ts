import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@chronicle/db";
import type { NotificationFrequency } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import {
  allowsImmediateDelivery,
  shouldDeliverImmediately,
} from "../src/notification-immediate";
import { setNotificationStreamFrequency } from "../src/notification-prefs";

async function seedPerson(db: Awaited<ReturnType<typeof createTestDatabase>>) {
  const [p] = await db
    .insert(persons)
    .values({ spokenName: "Sofia", displayName: "Sofia", lifeStatus: "living" })
    .returning();
  return p!.id;
}

describe("allowsImmediateDelivery (pure policy / #277 plug point)", () => {
  it.each([
    ["off", false],
    ["every_item", true],
    // Digests still immediate until digest assembly (#277) flips this policy.
    ["daily_digest", true],
    ["weekly_digest", true],
  ] as const satisfies ReadonlyArray<readonly [NotificationFrequency, boolean]>)(
    "%s → %s",
    (frequency, expected) => {
      expect(allowsImmediateDelivery(frequency)).toBe(expected);
    },
  );
});

describe("shouldDeliverImmediately(person, stream)", () => {
  it("returns false when the stream is off", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    await setNotificationStreamFrequency(db, personId, "questions_for_me", "off");
    expect(await shouldDeliverImmediately(db, personId, "questions_for_me")).toBe(false);
  });

  it("returns true for every_item and for absent prefs (default)", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    expect(await shouldDeliverImmediately(db, personId, "family_activity")).toBe(true);

    await setNotificationStreamFrequency(db, personId, "family_activity", "every_item");
    expect(await shouldDeliverImmediately(db, personId, "family_activity")).toBe(true);
  });

  it("returns true for digest frequencies until #277 assembly exists", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    await setNotificationStreamFrequency(db, personId, "answers_to_my_asks", "daily_digest");
    expect(await shouldDeliverImmediately(db, personId, "answers_to_my_asks")).toBe(true);

    await setNotificationStreamFrequency(db, personId, "answers_to_my_asks", "weekly_digest");
    expect(await shouldDeliverImmediately(db, personId, "answers_to_my_asks")).toBe(true);
  });

  it("is stream-scoped: off on one stream does not suppress another", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    await setNotificationStreamFrequency(db, personId, "questions_for_me", "off");
    expect(await shouldDeliverImmediately(db, personId, "questions_for_me")).toBe(false);
    expect(await shouldDeliverImmediately(db, personId, "family_activity")).toBe(true);
  });
});
