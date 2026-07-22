/**
 * Server-side integration test for the notification-stream-frequency save action (#280).
 *
 * The UI only ever offers every_item|off (digest cadences are not yet built), so the action must
 * reject any other NotificationFrequency value even though the DB type allows it — otherwise a
 * crafted request could silently store a digest frequency nothing renders yet.
 *
 * Harness mirrors pending-invites-actions.server.test.ts: `@/lib/runtime` is mocked so importing
 * the actions module doesn't boot the real DEV runtime.
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
import { persons } from "@chronicle/db/schema";
import {
  getNotificationStreamFrequency,
  listNotificationStreamFrequencies,
} from "@chronicle/core";
import { saveNotificationStreamFrequencyAction } from "@/app/hub/settings/actions";

async function makePerson(db: Database, name = "Sofia"): Promise<string> {
  const [p] = await db.insert(persons).values({ displayName: name, spokenName: name }).returning();
  return p!.id;
}

describe("saveNotificationStreamFrequencyAction", () => {
  beforeEach(async () => {
    runtimeDb = await createTestDatabase();
    authCtx = { kind: "none" };
  });

  it("persists off for family_activity and reload resolves off", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };
    const result = await saveNotificationStreamFrequencyAction("family_activity", "off");
    expect(result).toEqual({ ok: true });
    expect(await getNotificationStreamFrequency(runtimeDb, personId, "family_activity")).toBe("off");
  });

  it("rejects daily_digest so digests cannot be stored via settings", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };
    const result = await saveNotificationStreamFrequencyAction("answers_to_my_asks", "daily_digest");
    expect(result).toEqual({ error: "invalid_frequency" });
    expect(await getNotificationStreamFrequency(runtimeDb, personId, "answers_to_my_asks")).toBe(
      "every_item",
    );
  });

  it("rejects weekly_digest", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };
    const result = await saveNotificationStreamFrequencyAction("questions_for_me", "weekly_digest");
    expect(result).toEqual({ error: "invalid_frequency" });
  });

  it("rejects unknown stream", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };
    const result = await saveNotificationStreamFrequencyAction("not_a_stream" as never, "off");
    expect(result).toEqual({ error: "invalid_stream" });
  });

  it("requires signed-in account", async () => {
    const result = await saveNotificationStreamFrequencyAction("family_activity", "off");
    expect(result).toEqual({ error: "not_signed_in" });
  });

  it("list defaults are every_item when no rows (page load contract)", async () => {
    const personId = await makePerson(runtimeDb);
    expect(await listNotificationStreamFrequencies(runtimeDb, personId)).toEqual({
      questions_for_me: "every_item",
      answers_to_my_asks: "every_item",
      family_activity: "every_item",
    });
  });
});
