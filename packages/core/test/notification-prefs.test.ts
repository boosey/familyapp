import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@chronicle/db";
import { persons, notificationStreamPrefs } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import {
  DEFAULT_NOTIFICATION_FREQUENCY,
  NOTIFICATION_STREAMS,
  getNotificationStreamFrequency,
  setNotificationStreamFrequency,
  listNotificationStreamFrequencies,
} from "../src/notification-prefs";

async function seedPerson(db: Awaited<ReturnType<typeof createTestDatabase>>) {
  const [p] = await db
    .insert(persons)
    .values({ spokenName: "Sofia", displayName: "Sofia", lifeStatus: "living" })
    .returning();
  return p!.id;
}

describe("notification-prefs", () => {
  it("resolves absent rows to every_item for each stream", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    for (const stream of NOTIFICATION_STREAMS) {
      expect(await getNotificationStreamFrequency(db, personId, stream)).toBe("every_item");
    }
    expect(await listNotificationStreamFrequencies(db, personId)).toEqual({
      questions_for_me: "every_item",
      answers_to_my_asks: "every_item",
      family_activity: "every_item",
    });
    expect(DEFAULT_NOTIFICATION_FREQUENCY).toBe("every_item");
  });

  it("set then get returns the written frequency, including off and digests", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    await setNotificationStreamFrequency(db, personId, "family_activity", "off");
    expect(await getNotificationStreamFrequency(db, personId, "family_activity")).toBe("off");

    await setNotificationStreamFrequency(db, personId, "questions_for_me", "daily_digest");
    await setNotificationStreamFrequency(db, personId, "answers_to_my_asks", "weekly_digest");
    expect(await getNotificationStreamFrequency(db, personId, "questions_for_me")).toBe(
      "daily_digest",
    );
    expect(await getNotificationStreamFrequency(db, personId, "answers_to_my_asks")).toBe(
      "weekly_digest",
    );
  });

  it("set upserts: changing frequency updates the same person×stream row", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    await setNotificationStreamFrequency(db, personId, "family_activity", "off");
    await setNotificationStreamFrequency(db, personId, "family_activity", "every_item");
    expect(await getNotificationStreamFrequency(db, personId, "family_activity")).toBe(
      "every_item",
    );
    const rows = await db
      .select()
      .from(notificationStreamPrefs)
      .where(eq(notificationStreamPrefs.personId, personId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.frequency).toBe("every_item");
  });

  it("list merges stored prefs with defaults for unset streams", async () => {
    const db = await createTestDatabase();
    const personId = await seedPerson(db);
    await setNotificationStreamFrequency(db, personId, "answers_to_my_asks", "off");
    expect(await listNotificationStreamFrequencies(db, personId)).toEqual({
      questions_for_me: "every_item",
      answers_to_my_asks: "off",
      family_activity: "every_item",
    });
  });
});
